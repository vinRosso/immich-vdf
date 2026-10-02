# immich-vdf

Find duplicate photos and videos in a folder or an [Immich](https://immich.app) library, compare them, and clear the ones you do not want.

![Duplicate groups in an Immich library](docs/images/app.jpg)

Built on [Video Duplicate Finder](https://github.com/0x90d/videoduplicatefinder). [AGPL-3.0](LICENSE).

## Run

Install Docker. In an empty directory, save [docker-compose.example.yml](docker-compose.example.yml) as `docker-compose.yml` and [.env.example](.env.example) as `.env`. Set `APP_PASSWORD`, `MEDIA_PATH`, and `IMMICH_PATH`.

```bash
docker compose up -d
```

Open `http://<host>:4747`. The rest of the setup is in [Install](https://vinrosso.github.io/immich-vdf/install).

## Documentation

Hosted at **[vinrosso.github.io/immich-vdf](https://vinrosso.github.io/immich-vdf/)**.

- [Install](https://vinrosso.github.io/immich-vdf/install)
- [Configuration](https://vinrosso.github.io/immich-vdf/configuration)
- [Usage](https://vinrosso.github.io/immich-vdf/usage)
- [Security](https://vinrosso.github.io/immich-vdf/security)
- [Development](https://vinrosso.github.io/immich-vdf/development)
- [Updating the engine](https://github.com/vinRosso/immich-vdf/blob/main/FORK.md)
