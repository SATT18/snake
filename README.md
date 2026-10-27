# Snake

Змейка на TypeScript с яркой мультяшной 3D-графикой (Three.js: PBR-материалы, мягкие тени, ambient occlusion, HDR bloom, частицы), упакованная в нативное приложение для Windows через Electron. Поле — парящий остров над океаном, камера от третьего лица с фиксированным углом плавно следует за змейкой.

## Управление

- Стрелки / WASD — движение
- Пробел / P / Esc — пауза
- Enter — новая игра

## Запуск

```bash
npm install
npm start
```

## Сборка .exe

```bash
npm run dist
```

Готовые файлы появятся в `release/`: установщик `Snake Setup <версия>.exe` и portable `Snake <версия>.exe`.
