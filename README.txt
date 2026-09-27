# The Door
Aplicativo PWA para controle de encomendas de condomínio.

## Recursos desta versão
- Cadastro de moradores: nome, bloco, rua, quadra, apartamento e WhatsApp.
- Registro de encomendas e dados do entregador/transportadora.
- Histórico de encomendas.
- Baixa manual ou por leitura de QR Code.
- Geração de QR Code para cada encomenda.
- Botão para abrir o WhatsApp com mensagem de retirada.
- Exclusão de encomendas e moradores.
- Dashboard da portaria.
- Interface responsiva em tons de madeira e mostarda.
- Dados locais no navegador (localStorage).

## Como testar
1. Extraia o ZIP.
2. Publique a pasta em um servidor HTTPS ou rode um servidor local.
3. Abra no celular e use "Adicionar à tela inicial".
4. A câmera para QR normalmente exige HTTPS (localhost é exceção).

## Próxima etapa recomendada
Para uso real por vários funcionários/aparelhos, substituir o armazenamento local por banco de dados (Supabase/Firebase) e integrar WhatsApp Business API para envio automático do QR Code.
