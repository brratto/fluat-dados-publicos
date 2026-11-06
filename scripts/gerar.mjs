// Gera os arquivos públicos que o FLUAT baixa: índice de fundos da CVM e taxas do Tesouro Direto.
// Uso: node scripts/gerar.mjs <pasta-com-os-arquivos-baixados> <pasta-de-saida>
//   entrada: registro_classe.csv (de registro_fundo_classe.zip, CVM) e PrecoTaxaTesouroDireto.csv
//   saída:   fundos/indice.json, tesouro/titulos.json, tesouro/taxas/<titulo>.json, meta.json
// Sem dependências. Só dados públicos entram aqui — nada do usuário.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const [entrada, saida] = process.argv.slice(2);
if (!entrada || !saida) { console.error('uso: node scripts/gerar.mjs <entrada> <saida>'); process.exit(2); }

const linhasCsv = (arq, encoding) => new TextDecoder(encoding).decode(readFileSync(join(entrada, arq))).split(/\r?\n/).filter(Boolean);
const dataIso = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const numero = s => (s == null || s === '' ? null : Number(String(s).replace(',', '.')));
const json = (arq, obj) => { const p = join(saida, arq); mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, JSON.stringify(obj)); return p; };
const falha = msg => { console.error('ERRO: ' + msg); process.exit(1); };

rmSync(saida, { recursive: true, force: true });
mkdirSync(saida, { recursive: true });
const geradoEm = new Date().toISOString();

// ---------- Fundos (CVM, cadastro de classes da Resolução 175) ----------
{
  const L = linhasCsv('registro_classe.csv', 'latin1');
  const cab = L[0].split(';');
  const col = n => { const i = cab.indexOf(n); if (i < 0) falha(`coluna ${n} sumiu do registro_classe.csv — a CVM mudou o formato`); return i; };
  const c = { cnpj: col('CNPJ_Classe'), nome: col('Denominacao_Social'), sit: col('Situacao'), exc: col('Exclusivo'),
    ind: col('Indicador_Desempenho'), anbima: col('Classificacao_Anbima'), trib: col('Tributacao_Longo_Prazo'),
    tipo: col('Tipo_Classe'), pl: col('Patrimonio_Liquido') };
  const linhas = [];
  let malformadas = 0;
  for (const l of L.slice(1)) {
    const v = l.split(';');
    if (v.length !== cab.length) { malformadas++; continue; }
    if (!v[c.sit].startsWith('Em Funcionamento') || v[c.exc] === 'S') continue;   // só o que uma pessoa física compra
    linhas.push([v[c.cnpj].replace(/\D/g, ''), v[c.nome].replace(/\s+/g, ' ').trim(), v[c.ind] || null, v[c.anbima] || null,
      v[c.trib] || null, v[c.tipo].replace('Classes de Cotas de Fundos ', '') || null, Math.round(numero(v[c.pl]) || 0)]);
  }
  if (linhas.length < 10000) falha(`só ${linhas.length} fundos — esperado mais de 10 mil; arquivo da CVM incompleto?`);
  linhas.sort((a, b) => b[6] - a[6]);   // maior patrimônio primeiro: desempate natural da busca por nome
  json('fundos/indice.json', { gerado_em: geradoEm, fonte: 'CVM — dados.cvm.gov.br (registro_fundo_classe)',
    campos: ['cnpj', 'nome', 'indicador_desempenho', 'classificacao_anbima', 'tributacao_longo_prazo', 'tipo_classe', 'patrimonio_liquido'], linhas });
  console.log(`fundos: ${linhas.length} classes (${malformadas} linhas malformadas ignoradas)`);
  globalThis.__fundos = linhas.length;
}

// ---------- Tesouro Direto (Tesouro Transparente) ----------
{
  const L = linhasCsv('PrecoTaxaTesouroDireto.csv', 'utf-8');
  const cab = L[0].split(';');
  const esperado = ['Tipo Titulo', 'Data Vencimento', 'Data Base', 'Taxa Compra Manha', 'Taxa Venda Manha', 'PU Compra Manha', 'PU Venda Manha', 'PU Base Manha'];
  if (esperado.some((n, i) => cab[i] !== n)) falha('cabeçalho do PrecoTaxaTesouroDireto.csv mudou: ' + cab.join(';'));
  const porTitulo = new Map();
  for (const l of L.slice(1)) {
    const [tipo, venc, base, txC, txV, puC, puV, puB] = l.split(';');
    const vencimento = dataIso(venc), data = dataIso(base);
    if (!tipo || !vencimento || !data) continue;
    const k = `${tipo}|${vencimento}`;
    if (!porTitulo.has(k)) porTitulo.set(k, { tipo, vencimento, dias: [] });
    porTitulo.get(k).dias.push([data, numero(txC), numero(txV), numero(puC), numero(puV), numero(puB)]);
  }
  if (porTitulo.size < 50) falha(`só ${porTitulo.size} títulos do Tesouro — arquivo incompleto?`);
  const slug = (tipo, venc) => (tipo.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\+/g, 'mais').replace(/[^a-z0-9]+/g, '-') + '-' + venc).replace(/^-|-$/g, '');
  const titulos = [];
  for (const t of porTitulo.values()) {
    t.dias.sort((a, b) => a[0].localeCompare(b[0]));
    const arquivo = `tesouro/taxas/${slug(t.tipo, t.vencimento)}.json`;
    json(arquivo, { tipo: t.tipo, vencimento: t.vencimento, campos: ['data', 'taxa_compra', 'taxa_venda', 'pu_compra', 'pu_venda', 'pu_base'], dias: t.dias });
    const ult = t.dias[t.dias.length - 1];
    titulos.push({ tipo: t.tipo, vencimento: t.vencimento, arquivo, primeira_data: t.dias[0][0], ultima_data: ult[0],
      taxa_compra: ult[1], pu_compra: ult[3], pu_base: ult[5] });
  }
  titulos.sort((a, b) => a.tipo.localeCompare(b.tipo) || a.vencimento.localeCompare(b.vencimento));
  json('tesouro/titulos.json', { gerado_em: geradoEm, fonte: 'Tesouro Transparente — PrecoTaxaTesouroDireto.csv', titulos });
  console.log(`tesouro: ${titulos.length} títulos, última data ${titulos.map(t => t.ultima_data).sort().pop()}`);
  globalThis.__tesouro = titulos.length;
}

json('meta.json', { gerado_em: geradoEm, fundos: globalThis.__fundos, titulos_tesouro: globalThis.__tesouro, versao: 1 });
writeFileSync(join(saida, 'index.html'), '<!doctype html><meta charset="utf-8"><title>FLUAT dados públicos</title>' +
  '<p>Arquivos públicos usados pelo FLUAT: <a href="meta.json">meta.json</a>, <a href="fundos/indice.json">fundos/indice.json</a>, ' +
  '<a href="tesouro/titulos.json">tesouro/titulos.json</a>. Fontes: CVM e Tesouro Transparente.</p>');
console.log('ok →', saida);
