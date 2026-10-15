# The Door

Aplicativo web para gestão de encomendas na portaria, com tema madeira e mostarda.

## Moradores por unidade
- Lista de moradores agrupada por bloco, rua, quadra e apartamento.
- Permite adicionar vários moradores à mesma unidade.
- Permite editar nome, telefone/WhatsApp e dados da unidade sem perder o cadastro.
- A edição mantém o mesmo identificador do morador para preservar vínculos com encomendas já cadastradas.

## Publicação
O GitHub Actions compila o projeto com Vite e publica a pasta `dist` no GitHub Pages.
Os dados desta versão são guardados no armazenamento local do navegador. Banco de dados compartilhado entre dispositivos será configurado em etapa posterior.
