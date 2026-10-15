# The Door — MVP funcional

Aplicativo web responsivo para controle de encomendas de condomínio.

## Funcionalidades
- Dashboard de portaria
- Cadastro de moradores (nome, WhatsApp, bloco, rua, quadra, apartamento)
- Cadastro de entregadores
- Registro de encomendas
- Histórico de encomendas e retiradas
- Exclusão de encomendas
- Geração lógica de código único `TD-XXXXXX`
- Envio de aviso pelo WhatsApp via link `wa.me`
- Leitor de QR Code pela câmera para dar baixa
- Persistência local no navegador via localStorage
- Interface responsiva para celular e computador

## Executar
1. Instale Node.js 18+.
2. `npm install`
3. `npm run dev`
4. Abra o endereço mostrado pelo Vite.

## Observações de produção
Este MVP usa localStorage. Para uso real em vários celulares/computadores, substitua por backend/banco de dados (ex.: Supabase/Firebase), autenticação de funcionários, armazenamento centralizado e integração oficial do WhatsApp Business Cloud API.

## Próximas evoluções
- QR Code visual na tela e PDF/impressão da etiqueta
- Integração WhatsApp Business API
- Login e permissões
- Banco online e sincronização em tempo real
- Relatórios/exportação
- Auditoria de exclusões e baixas
- PWA instalável
