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

O app baixa o índice inteiro e procura no próprio aparelho: este site nunca recebe o que o usuário tem.

Gerar localmente (precisa dos dois arquivos de origem em `entrada/`):

```
node scripts/gerar.mjs entrada publicar
```

Plano completo no projeto do app: `docs/PLANO-RENDA-FIXA-INDEXADA.md`.
