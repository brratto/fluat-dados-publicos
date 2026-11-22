# FLUAT — dados públicos

Arquivos derivados de dados **públicos** que o app FLUAT baixa para identificar fundos e títulos do
Tesouro sozinho, na importação. Um GitHub Action roda todo dia, baixa as fontes, gera os arquivos e
publica pelo GitHub Pages. Este repositório não tem código do app nem nenhum dado de usuário.

| Arquivo | Conteúdo | Fonte |
|---|---|---|
| `meta.json` | Data da geração e contagens | — |
| `fundos/indice.json` | Fundos em funcionamento e não exclusivos: CNPJ, nome, indicador de desempenho, classificação ANBIMA, tributação, tipo, patrimônio | [CVM — dados abertos](https://dados.cvm.gov.br/dataset/fi-cad) |
| `tesouro/titulos.json` | Títulos do Tesouro Direto com vencimento e última taxa/preço | [Tesouro Transparente](https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto) |
| `tesouro/taxas/<titulo>.json` | Histórico diário de taxa e preço de compra/venda de um título | idem |
| `fundos/cotas/meta.json` | Anos disponíveis, última data e a regra do balde | [CVM — informe diário](https://dados.cvm.gov.br/dataset/fi-doc-inf_diario) |
| `fundos/cotas/<ano>/<balde>.json` | Cota diária de todos os fundos (exclusivos inclusive) cujo CNPJ cai naquele balde, desde 2021 | idem |

O app baixa o índice inteiro e procura no próprio aparelho: este site nunca recebe o que o usuário tem.

As cotas vêm em 256 baldes por ano: balde = FNV-1a de 32 bits dos 14 dígitos do CNPJ, módulo 256. O app
pede só o balde do fundo, que mistura de 70 a 140 fundos: este site fica sabendo o balde, não o fundo.
Cada série é `"<cnpj>"` ou `"<cnpj>:<subclasse>"`, com `q` alinhado com `datas` (0 = sem informe no dia) e
`n` = número de cotistas no último dia informado.

Gerar localmente (precisa dos dois arquivos de origem em `entrada/`):

```
node scripts/gerar.mjs entrada publicar
node scripts/cotas.mjs publicar cache/cotas --desde 2021   # baixa o informe diário da CVM (~11 MB por mês)
```

Plano completo no projeto do app: `docs/PLANO-RENDA-FIXA-INDEXADA.md`.
