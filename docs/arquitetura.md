# Arquitetura e dados

| Camada | Implementação | Responsabilidade |
|---|---|---|
| PWA | HTML, CSS, JavaScript e service worker em `dist/` | Interface, instalação e cache dos recursos essenciais |
| Acervo | IndexedDB no navegador | Bolhas, rascunhos, anexos, preferências de conversa e fila de publicação |
| API | Node.js 24 e Fastify em `server/` | Convites, sessão, círculo, perfis, publicações, seguidores e administração |
| Banco | SQLite em modo WAL | Registros compartilhados, permissões e sequência de sincronização |
| Operação | Docker Compose | Contêiner da aplicação e volume persistente |

## Sincronização

A PWA registra a escrita local e a operação pendente na mesma transação do IndexedDB. Quando o app está aberto e tem conexão, envia a operação e consulta as mudanças posteriores ao último cursor. O servidor verifica a sessão e usa um identificador estável para aceitar reenvios sem duplicar uma publicação. O cache do service worker atende os arquivos da interface. Conteúdo autenticado é consultado pela API.

O piloto suporta um círculo privado por instância. O servidor mantém os dados compartilhados do círculo. Rascunhos e bytes dos anexos ficam no navegador. A publicação inclui tema, pergunta, hashtags, ensaio e novos Ecos de texto. O aviso de novos Ecos é calculado no dispositivo. A aplicação não solicita GPS.

## Dois formatos de backup

O ZIP da Biblioteca contém `acervo.json`, textos Markdown e anexos, e pode ser restaurado em outra instalação compatível. O snapshot SQLite preserva o estado administrativo de uma instância e precisa ser guardado à parte. Trate ambos como dados privados.
