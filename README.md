# Expand

Expand é uma rede social local-first, criada pela **Zona Educacional**, para conversar em círculos privados. Cada bolha tem uma pergunta, Ecos com perspectivas diferentes e um ensaio para aprofundar a leitura. O acervo pessoal fica no navegador e pode ser exportado em um ZIP com Markdown, JSON e anexos.

A instância original está em [expand.vibelab.app.br](https://expand.vibelab.app.br). Uma instalação nova começa com o acervo vazio. Um administrador cria o primeiro círculo e gera os convites.

## Começar

Para experimentar a PWA local sem servidor de sincronização:

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Abra [localhost:8765](http://localhost:8765). Depois do primeiro carregamento, a interface, os rascunhos e o acervo local ficam disponíveis offline.

Para rodar a PWA com o servidor de círculos, use Docker com o plugin Compose:

```sh
docker compose up -d --build
docker compose exec -T expand node server/admin.js admin-invite
```

Abra [localhost:3060](http://localhost:3060), use o convite em **Círculo Expand** e entre em **Administração → Criar primeiro círculo**. O convite expira em 24 horas e concede acesso administrativo a quem o resgatar. Use um canal privado para entregá-lo.

## Documentação

- [Guia de uso](docs/uso.md)
- [Arquitetura e dados](docs/arquitetura.md)
- [Hospedagem, administração e backup](docs/operacao.md)
- [Créditos e componentes de terceiros](NOTICE.md)

A versão atual sincroniza textos do círculo, perfis, permissões e relações de seguir. Capas, avatares, áudios e vídeos adicionados ao acervo ficam no aparelho. A distribuição de mídia entre pares é uma etapa futura.

## Licença

O código do Expand é distribuído sob a [GNU Affero General Public License, versão 3](LICENSE), identificada como `AGPL-3.0-only`. A licença preserva os avisos de autoria e exige que quem operar uma versão modificada pela rede ofereça o código-fonte correspondente aos usuários dessa versão.

Copyright © 2026 Zona Educacional. A referência original do projeto é [zonaeducacional/expand](https://github.com/zonaeducacional/expand). Consulte [NOTICE.md](NOTICE.md) para os créditos e as licenças próprias de terceiros.
