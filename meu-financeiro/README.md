# Meu Financeiro

Primeira estrutura do app pessoal de finanças. O protótipo enviado serviu como referência de recursos; esta interface e a API foram iniciadas do zero.

## Tecnologias

- Interface web responsiva em HTML, CSS separado e JavaScript.
- Node.js + Express para servir a interface e a API.
- MySQL para renda, contas, compras parceladas, dívidas e movimentações.
- PWA preparada para a etapa de instalação no celular.

## Abrir no VS Code

1. Abra a pasta `meu-financeiro` no VS Code.
2. Se as dependências ainda não estiverem instaladas, execute `npm install` no terminal integrado.
3. Configure `DB_PASSWORD` no arquivo `.env` (ele é local e não vai para o Git).
4. Rode **Terminal → Executar Tarefa → Meu Financeiro: configurar MySQL** para criar o banco e as tabelas.
5. Rode **Terminal → Executar Tarefa → Meu Financeiro: iniciar**.
6. Abra `http://localhost:3000`; no primeiro acesso, crie seu usuário e sua senha do app.

## Abrir pelo ícone da Área de Trabalho

No Windows, use o atalho **Meu Financeiro**. Ele tenta iniciar o serviço MySQL e o servidor do app e abre o navegador. O serviço MySQL precisa estar configurado para iniciar com o Windows; assim, não é necessário abrir o MySQL manualmente toda vez.

## O que já está implementado

- Registrar renda e consultar previsão mensal.
- Criar um acesso protegido por senha; as senhas são armazenadas com hash scrypt.
- Criar contas recorrentes e registrar pagamento por mês.
- Criar compras parceladas e registrar parcelas pagas.
- Editar e arquivar rendas, contas, compras parceladas e dívidas sem apagar pagamentos antigos.
- Cadastrar dívidas e abater valores com saldo restante no histórico.
- Mostrar o progresso de quitação e a evolução mensal do saldo de dívidas.
- Exportar todos os registros para um arquivo JSON de backup.
- Restaurar um backup com confirmação antes de substituir os registros atuais.
- Avisar no painel quando contas estiverem vencidas ou vencerem nos próximos 7 dias; notificações do navegador são opcionais.
- Mostrar saldo mensal negativo em vermelho quando contas e compromissos previstos ultrapassam a renda cadastrada.

## Uso no celular e lembretes

O layout se adapta a computadores e celulares. Os lembretes dentro do painel ficam disponíveis quando o app está aberto. Se ativadas, notificações do navegador avisam sobre contas que vencem em até três dias; elas não são enviadas com o app fechado, pois isso exige um serviço de notificações remotas.

O servidor atual escuta em `127.0.0.1`, então os dados ficam no computador onde o MySQL está instalado. Para abrir o mesmo app no celular e sincronizar os dados, é necessário hospedar a API e o MySQL em um servidor acessível com HTTPS. O service worker guarda apenas os arquivos visuais; operações com dados precisam da API e do MySQL conectados.
