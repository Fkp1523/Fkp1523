# Meu Financeiro

Controle pessoal de renda, contas recorrentes, compras parceladas e dívidas. No computador, os registros ficam no MySQL. No Android, ficam no próprio celular e podem ser usados sem internet.

## Tecnologias

- Interface web responsiva em HTML, CSS separado e JavaScript.
- Node.js + Express para servir a interface e a API.
- MySQL para renda, contas, compras parceladas, dívidas e movimentações.
- Instalador Android com armazenamento local em IndexedDB.

## Abrir no VS Code

1. Abra a pasta `meu-financeiro` no VS Code.
2. Instale as dependências com `npm ci` no terminal integrado.
3. Copie `.env.example` para `.env` e configure o usuário e a senha do seu MySQL.
4. Rode **Terminal → Executar Tarefa → Meu Financeiro: configurar MySQL** para criar o banco e as tabelas.
5. Rode **Terminal → Executar Tarefa → Meu Financeiro: iniciar**.
6. Abra `http://localhost:3000`; no primeiro acesso, crie seu usuário e sua senha do app.

## Abrir pelo ícone da Área de Trabalho

No Windows, use o atalho **Meu Financeiro** depois de configurar o banco uma vez. O atalho executa o arquivo `Iniciar Meu Financeiro.ps1`, que tenta iniciar o serviço MySQL, inicia o servidor local e abre o navegador. O ícone de nota está em `public/icon.ico`.

## Instalar no Android

1. [Baixe o instalador do Meu Financeiro](https://github.com/Fkp1523/Fkp1523/raw/refs/heads/main/meu-financeiro/downloads/Meu-Financeiro-Android.apk).
2. Abra o APK no Android e siga a tela de instalação.
3. Abra **Meu Financeiro** e registre suas contas e dívidas. Todos os dados ficam no aparelho.

## Transferir registros entre Android e computador

| Direção | O que fazer |
| --- | --- |
| Computador → Android | No computador, vá a **Histórico → Baixar backup**. Passe o arquivo ao celular e use **Histórico → Importar backup**. |
| Android → computador | No celular, vá a **Histórico → Exportar backup**. Passe o arquivo ao computador e use **Histórico → Restaurar backup**. |

Você pode copiar o arquivo por cabo USB. A importação substitui os registros no aparelho que recebe. Faça um backup dele antes de restaurar.

## O que já está implementado

- Registrar renda e consultar previsão mensal.
- Criar um acesso com senha no computador. O servidor guarda as senhas com hash scrypt.
- Escolher o mês e o ano ou avançar e voltar mês a mês. Contas mensais se repetem a partir do mês escolhido.
- Manter contas avulsas na lista até o pagamento. Contas pagas ficam disponíveis no Histórico.
- Criar compras parceladas e registrar parcelas pagas.
- Editar e arquivar rendas, contas, compras parceladas e dívidas sem apagar pagamentos antigos.
- Abater valores diferentes da mesma dívida e ver o saldo restante a cada pagamento.
- Mostrar o progresso de quitação e a evolução mensal do saldo de dívidas.
- Exportar todos os registros para um arquivo JSON de backup.
- Restaurar um backup com confirmação antes de substituir os registros atuais.
- Avisar no painel quando contas estiverem vencidas ou vencerem nos próximos 7 dias; notificações do navegador são opcionais.
- Mostrar quanto já saiu, quanto ainda está previsto e o saldo em vermelho quando essas despesas ultrapassam a renda.

Os lembretes aparecem no painel enquanto o app está aberto. No computador, o navegador também pode mostrar notificações se você ativá-las.
