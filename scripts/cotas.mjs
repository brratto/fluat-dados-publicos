// Gera a cota diária de todos os fundos da CVM, separada em "baldes" de CNPJ, para o FLUAT buscar
// só o balde do fundo da pessoa: este site fica sabendo o balde (de 70 a 140 fundos misturados), não
// o fundo. Plano no projeto do app: docs/PLANO-INFORME-E-CURVA.md §5.2 e §7 (decisão 1, opção b).
//
// Uso: node scripts/cotas.mjs <pasta-de-saida> [<pasta-de-cache>] [--desde AAAA] [--ate AAAAMM]
//   saída: fundos/cotas/meta.json e fundos/cotas/<ano>/<balde>.json (balde de 000 a 255)
//   cache: anos fechados há mais de um ano (a CVM reapresenta meses por até ~12 meses) ficam
//          guardados entre execuções; os outros são baixados de novo a cada dia.
//
// Balde = FNV-1a de 32 bits dos 14 dígitos do CNPJ, módulo 256 (a mesma conta roda no app).
// Formato de cada arquivo:
//   { v:1, ano, balde, datas:[AAAA-MM-DD…], series:{ "<cnpj>" | "<cnpj>:<subclasse>": {n, q:[…]} } }
//   q alinhado com datas (0 = o fundo não informou naquele dia), cota com 10 algarismos significativos;
//   n = número de cotistas no último dia informado (para escolher a subclasse de varejo).
// Fonte: informe diário da CVM (inf_diario_fi_AAAAMM.zip), todos os fundos, exclusivos inclusive
// (previdência usa a cota do FIE, que costuma ser exclusivo). Sem dependências além do `unzip`.
import { writeFileSync, mkdirSync, existsSync, readdirSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const args = process.argv.slice(2);
const opt = (n, pad) => { const i = args.indexOf(n); if (i < 0) return pad; const v = args[i + 1]; args.splice(i, 2); return v; };
const desde = Number(opt('--desde', '2021'));
const ateOpt = opt('--ate', null);
const [saida, cache] = args;
if (!saida) { console.error('uso: node scripts/cotas.mjs <saida> [<cache>] [--desde AAAA] [--ate AAAAMM]'); process.exit(2); }
const falha = msg => { console.error('ERRO: ' + msg); process.exit(1); };

export const BALDES = 256;
export const balde = cnpj => { let h = 0x811c9dc5; for (let i = 0; i < cnpj.length; i++) { h ^= cnpj.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h % BALDES; };
const nomeBalde = b => String(b).padStart(3, '0');

const hoje = new Date();
const ateAno = ateOpt ? Number(ateOpt.slice(0, 4)) : hoje.getUTCFullYear();
const ateMes = ateOpt ? Number(ateOpt.slice(4, 6)) : hoje.getUTCMonth() + 1;
const fechado = ano => ano <= ateAno - 2;   // a CVM já não reapresenta esses meses
const BASE = 'https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS/';
const tmp = join(tmpdir(), 'fluat-cotas');
mkdirSync(tmp, { recursive: true });

async function baixar(url, arq) {
  for (let t = 1; t <= 4; t++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(300000) });
      if (r.status === 404) return false;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      writeFileSync(arq, Buffer.from(await r.arrayBuffer()));
      return true;
    } catch (e) {
      if (t === 4) throw new Error(`${url}: ${e.message}`);
      await new Promise(ok => setTimeout(ok, 5000 * t));
    }
  }
}

// Lê um mês e acumula em `ano`: Map série → {n, dias: Map data → cota}
function lerMes(csv, ano, datas) {
  const L = csv.split(/\r?\n/);
  const cab = L[0].split(';');
  const ic = cab.findIndex(c => c === 'CNPJ_FUNDO_CLASSE' || c === 'CNPJ_FUNDO');
  const is = cab.indexOf('ID_SUBCLASSE'), id = cab.indexOf('DT_COMPTC'), iq = cab.indexOf('VL_QUOTA'), ik = cab.indexOf('NR_COTST');
  if (ic < 0 || id < 0 || iq < 0) falha('cabeçalho do informe diário mudou: ' + L[0]);
  let n = 0;
  for (let k = 1; k < L.length; k++) {
    const l = L[k]; if (!l) continue;
    const v = l.split(';');
    const cnpj = v[ic].replace(/\D/g, ''), d = v[id], q = Number(v[iq]);
    if (cnpj.length !== 14 || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !(q > 0)) continue;
    const chave = is >= 0 && v[is] ? cnpj + ':' + v[is] : cnpj;
    let s = ano.get(chave); if (!s) ano.set(chave, s = { n: 0, ult: '', dias: new Map() });
    s.dias.set(d, q);
    if (d >= s.ult) { s.ult = d; s.n = Number(v[ik]) || 0; }
    datas.add(d); n++;
  }
  return n;
}

function gravarAno(dir, anoN, ano, datas) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const D = [...datas].sort();
  const porBalde = Array.from({ length: BALDES }, () => []);
  for (const [chave, s] of ano) porBalde[balde(chave.slice(0, 14))].push([chave, s]);
  let bytes = 0;
  porBalde.forEach((lista, b) => {
    lista.sort((x, y) => x[0].localeCompare(y[0]));
    const ds = new Set(); lista.forEach(([, s]) => s.dias.forEach((_, d) => ds.add(d)));
    const datasB = D.filter(d => ds.has(d));
    const series = {};
    for (const [chave, s] of lista) series[chave] = { n: s.n, q: datasB.map(d => s.dias.has(d) ? +s.dias.get(d).toPrecision(10) : 0) };
    const txt = JSON.stringify({ v: 1, ano: anoN, balde: b, datas: datasB, series });
    writeFileSync(join(dir, nomeBalde(b) + '.json'), txt); bytes += txt.length;
  });
  const resumo = { ano: anoN, primeira: D[0] || null, ultima: D[D.length - 1] || null, series: ano.size, bytes };
  writeFileSync(join(dir, 'resumo.json'), JSON.stringify(resumo));
  return resumo;
}

const destino = join(saida, 'fundos', 'cotas');
mkdirSync(destino, { recursive: true });
const anos = [];
for (let a = desde; a <= ateAno; a++) {
  const cacheAno = cache && join(cache, String(a));
  if (fechado(a) && cacheAno && existsSync(join(cacheAno, 'resumo.json')) && readdirSync(cacheAno).length === BALDES + 1) {
    cpSync(cacheAno, join(destino, String(a)), { recursive: true });
    const r = JSON.parse(readFileSync(join(cacheAno, 'resumo.json'), 'utf8'));
    anos.push(r); console.log(`cotas ${a}: do cache (${r.series} séries até ${r.ultima})`);
    continue;
  }
  const ano = new Map(), datas = new Set();
  let meses = 0, linhas = 0;
  for (let m = 1; m <= (a === ateAno ? ateMes : 12); m++) {
    const am = `${a}${String(m).padStart(2, '0')}`, zip = join(tmp, `inf_${am}.zip`);
    if (!await baixar(`${BASE}inf_diario_fi_${am}.zip`, zip)) { console.log(`  ${am}: ainda não publicado`); continue; }
    const csv = execFileSync('unzip', ['-p', zip], { maxBuffer: 512 * 1024 * 1024 }).toString('latin1');
    linhas += lerMes(csv, ano, datas); meses++;
    rmSync(zip, { force: true });
  }
  if (!meses) { console.log(`cotas ${a}: nenhum mês publicado`); continue; }
  if (a < ateAno && meses < 12) falha(`${a}: só ${meses} meses baixados — a CVM tirou algum arquivo do ar?`);
  if (ano.size < 10000) falha(`${a}: só ${ano.size} séries — esperado mais de 10 mil; arquivo incompleto?`);
  const r = gravarAno(join(destino, String(a)), a, ano, datas);
  anos.push(r);
  console.log(`cotas ${a}: ${meses} meses, ${linhas} linhas, ${r.series} séries, ${(r.bytes / 1e6).toFixed(1)} MB, até ${r.ultima}`);
  if (fechado(a) && cacheAno) { rmSync(cacheAno, { recursive: true, force: true }); cpSync(join(destino, String(a)), cacheAno, { recursive: true }); }
}
if (!anos.length) falha('nenhum ano gerado');
writeFileSync(join(destino, 'meta.json'), JSON.stringify({
  v: 1, gerado_em: new Date().toISOString(), fonte: 'CVM — dados.cvm.gov.br (inf_diario_fi)', baldes: BALDES,
  balde: 'FNV-1a 32 bits dos 14 dígitos do CNPJ, módulo 256', arquivo: 'fundos/cotas/<ano>/<balde com 3 dígitos>.json',
  anos: anos.map(r => ({ ano: r.ano, primeira: r.primeira, ultima: r.ultima, series: r.series })),
}));
console.log('cotas ok →', destino);
