# Hospedar e administrar

## Instalação

Execute `docker compose up -d --build`. O serviço publica sua porta apenas em `127.0.0.1:3060`. Para acesso público, configure um proxy reverso HTTPS ou um túnel existente para encaminhar o domínio a essa porta. Confirme a saúde com `curl -fsS http://127.0.0.1:3060/api/health`. HTTPS é necessário para a PWA funcionar como contexto seguro em um domínio público.

O SQLite fica em `/data/expand.sqlite` no volume gerenciado pelo Compose. Mantenha esse volume ao atualizar o container. Uma instalação nova fica sem círculos e publicações. O conteúdo do círculo exige sessão; a interface pode ser aberta por visitantes.

## Administração

```sh
docker compose exec -T expand node server/admin.js admin-invite
docker compose exec -T expand node server/admin.js promote @arroba
```

Use a primeira opção para uma nova conta administrativa e a segunda para conceder acesso a uma conta existente. No painel, crie o círculo antes de emitir convites de membro. A área exibe métricas agregadas e o histórico de convites recentes. Convites ativos podem ser revogados.

## Backup e restauração

Crie um snapshot consistente e copie-o para um local privado fora do servidor:

```sh
docker compose exec -T expand node server/admin.js backup /tmp/expand-backup.sqlite
docker compose cp expand:/tmp/expand-backup.sqlite ./expand-backup.sqlite
chmod 600 ./expand-backup.sqlite
```

O script em [ops/backup-dell.sh](../ops/backup-dell.sh) automatiza a cópia via SSH e verifica a integridade do snapshot. Por padrão usa o alias SSH `n4050` e o diretório `/opt/expand`. Você pode passar outro alias e diretório por meio de `EXPAND_SSH_HOST` e `EXPAND_REMOTE_DIR`.

Para restaurar, coloque o snapshot como `expand.sqlite` em um volume novo com acesso de escrita para o usuário 1000 do container. Confirme a integridade, inicialize uma instância isolada com o novo volume e verifique as publicações pelo app antes de apontar o proxy para ela. Guarde o volume anterior até confirmar a recuperação.

## Atualizações da PWA

Publique uma nova versão no servidor com `docker compose up -d --build`. O servidor calcula a versão a partir do código da PWA e da API, incluindo o lockfile. Não é preciso ajustar manualmente o nome do cache. Depois do deploy, `/api/version` informa a versão servida.

Instalações abertas verificam a versão ao iniciar, ao reconectar, ao voltar ao primeiro plano e a cada 30 segundos enquanto estão visíveis. O service worker baixa todos os recursos antes de ativar a atualização. Uma falha no download mantém a versão anterior disponível. O app aplica a versão completa quando a edição ou operação em andamento terminar.

Uma instalação fechada verifica a versão ao ser reaberta. Em **Configurações → Atualizações do app**, existe uma verificação manual. O commit no GitHub fica disponível para implantação a partir do repositório. É o deploy no servidor de cada instância que disponibiliza a nova versão para seus aparelhos.
