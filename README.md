# The Door

Aplicativo web para gestão de encomendas na portaria, com tema madeira e mostarda.

## Dados e sincronização
- Firebase Authentication para login.
- Firestore para sincronizar moradores, entregadores, encomendas e correspondências por condomínio.
- Cada usuário operacional recebe um `condominioId` e só acessa os dados desse condomínio.
- A Central Administrativa do proprietário gerencia condomínios, licenças e convites de acesso.
- As fotos das encomendas permanecem no aparelho nesta etapa; os demais dados são sincronizados pela nuvem.

## Moradores por unidade
- Lista de moradores agrupada por bloco, rua, quadra e apartamento.
- Permite adicionar vários moradores à mesma unidade.
- Permite editar nome, telefone/WhatsApp e dados da unidade sem perder o cadastro.
- A edição mantém o mesmo identificador do morador para preservar vínculos com encomendas já cadastradas.

## Notificações
- Ao registrar uma encomenda, é possível escolher entre abrir o WhatsApp imediatamente ou deixar o aviso na Central de Notificações.
- A Central agrupa encomendas pendentes por morador.
- O WhatsApp é aberto com a mensagem preenchida; o atendente confirma o envio no próprio WhatsApp e depois marca o aviso como enviado no The Door.

## Publicação
O GitHub Actions compila o projeto com Vite e publica a pasta `dist` no GitHub Pages.
