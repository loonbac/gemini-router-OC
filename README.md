# Gemini Router — OpenCode Plugin

Servidor HTTP compatible con la API de OpenAI que actúa como puente hacia Gemini CLI. Se integra como plugin de [OpenCode](https://opencode.ai), iniciando automáticamente el router al abrir OpenCode y deteniéndolo al cerrar.

**Sin API key, sin cuentas de pago** — usa tu autenticación de Google existente del CLI de Gemini.

## ¿Qué hace esto?

```
OpenCode → GeminiRouter plugin → router HTTP (puerto 4789) → Gemini CLI → Google
```

Cuando abrís OpenCode, el plugin detecta si el router ya está corriendo. Si no lo está, lo spawnea automáticamente. Cuando cerrás OpenCode, el router se detiene. **Cero configuración manual.**

## Requisitos previos

| Requisito | Cómo verificar | Cómo instalar |
|-----------|---------------|---------------|
| **Node.js ≥ 20** | `node --version` | [nodejs.org](https://nodejs.org) |
| **Gemini CLI** | `gemini --version` | `npm install -g @anthropic-ai/claude-code` |
| **Gemini CLI autenticado** | Abrir `gemini` una vez | Te guía el primer uso |
| **OpenCode** | `opencode --version` | [opencode.ai](https://opencode.ai) |

## Instalación local (paso a paso)

### 1. Clonar el repositorio

```bash
git clone https://github.com/loonbac/gemini-router-OC.git ~/gemini-router-OC
cd ~/gemini-router-OC
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Compilar TypeScript

```bash
npm run build
```

Esto genera la carpeta `dist/` con los archivos compilados:
```
dist/
├── plugin.js      ← el plugin de OpenCode
├── server.js      ← el router HTTP
├── cli-path.js    ← detección del CLI de Gemini
├── format.js      ← conversión de formatos
├── streaming.js   ← streaming SSE
├── gemini-bridge.js ← puente al proceso Gemini
└── service/       ← gestión de servicio systemd (opcional)
```

### 4. Verificar que Gemini CLI está accesible

```bash
# Opción A: que esté en el PATH
which gemini

# Opción B: configurar variable de entorno (si no está en PATH)
export GEMINI_CLI_PATH="/ruta/a/tu/gemini"
```

### 5. Configurar OpenCode

Abrí tu archivo de configuración de OpenCode:

```bash
# Configuración global
nano ~/.config/opencode/opencode.json

# O configuración del proyecto
nano opencode.json
```

Agregá la ruta absoluta al plugin compilado en el array `plugin`:

```json
{
  "plugin": [
    "/home/tu-usuario/gemini-router-OC/dist/plugin.js"
  ],
  "provider": {
    "gemini": {
      "models": {
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro",
          "limit": { "context": 1048576, "output": 65536 }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "limit": { "context": 1048576, "output": 65536 }
        }
      },
      "name": "Gemini (via CLI)",
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://127.0.0.1:4789/v1"
      }
    }
  }
}
```

> **Importante**: Reemplazá `/home/tu-usuario/` con tu ruta real. Usá `pwd` en la carpeta del proyecto si no estás seguro.

### 6. Abrir OpenCode

```bash
opencode
```

El plugin hará:
1. Health check al puerto 4789
2. Si no hay router corriendo → spawnea `node dist/server.js`
3. Espera 2 segundos a que levante
4. OpenCode ya puede usar Gemini como provider

## Estructura del proyecto

```
gemini-router-OC/
├── src/
│   ├── server.ts            ← punto de entrada del router HTTP
│   ├── plugin.ts            ← plugin de OpenCode (auto-start/stop)
│   ├── cli-path.ts          ← detección dinámica del CLI de Gemini
│   ├── gemini-bridge.ts     ← puente que spawnea procesos Gemini
│   ├── format.ts            ← conversión OpenAI ↔ Gemini
│   ├── streaming.ts         ← NDJSON → SSE para streaming
│   ├── service/             ← gestión opcional de systemd
│   │   ├── index.ts         ← CLI para instalar/desinstalar servicio
│   │   ├── install.ts       ← crea servicio systemd de usuario
│   │   ├── uninstall.ts     ← elimina servicio systemd
│   │   └── template.ts      ← plantilla del unit file
│   ├── *.test.ts            ← tests unitarios
│   └── types/               ← declaraciones de tipos locales
├── dist/                    ← archivos compilados (generado por build)
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── vitest.config.ts
├── LICENSE
└── README.md
```

## Detección del CLI de Gemini

El router busca el ejecutable de Gemini en este orden:

| Prioridad | Método | Ejemplo |
|-----------|--------|---------|
| 1 | Variable de entorno `GEMINI_CLI_PATH` | `export GEMINI_CLI_PATH=/usr/local/bin/gemini` |
| 2 | `which gemini` | Encuentra en PATH |
| 3 | `command -v gemini` | Fallback para shells sin `which` |
| 4 | Prefijo global de npm | `/home/user/.npm-global/bin/gemini` |
| — | Error | Instrucciones de instalación claras |

Si no encuentra el CLI, el error es descriptivo y te dice exactamente qué hacer.

## Servicio systemd (opcional)

Si querés que el router corra como servicio permanente (no solo cuando OpenCode está abierto):

```bash
# Compilar primero
npm run build

# Instalar como servicio de usuario
node dist/service/index.js install

# Con puerto personalizado
node dist/service/index.js install --port 9000

# Desinstalar servicio
node dist/service/index.js uninstall
```

El servicio se registra en `~/.config/systemd/user/gemini-router.service` y:
- Se inicia automáticamente al hacer login
- Se reinicia automáticamente si crashea
- Usa tu Gemini CLI detectado automáticamente

## Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `GEMINI_CLI_PATH` | *(auto-detectado)* | Ruta absoluta al ejecutable `gemini` |
| `PORT` | `4789` | Puerto del servidor HTTP |
| `GEMINI_ROUTER_PORT` | `4789` | Puerto (alternativa, usa esta si existe) |

## Tests

```bash
# Ejecutar todos los tests
npm test

# Tests en modo watch
npx vitest
```

El proyecto tiene **156 tests** cubriendo:
- Resolución de rutas del CLI (28 tests)
- Generación de plantillas systemd (10 tests)
- Instalación de servicio (19 tests)
- Desinstalación de servicio (21 tests)
- CLI de gestión de servicio (18 tests)
- Plugin de OpenCode (10 tests)
- Servidor HTTP (13 tests)
- Conversión de formatos (11 tests)
- Streaming SSE (19 tests)
- Puente Gemini CLI (7 tests)

## Scripts disponibles

| Comando | Descripción |
|---------|-------------|
| `npm run dev` | Modo desarrollo con hot-reload |
| `npm run start` | Iniciar el router compilado |
| `npm run build` | Compilar TypeScript a `dist/` |
| `npm test` | Ejecutar tests con vitest |

## API endpoints

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Health check (usado por el plugin) |
| `POST` | `/v1/chat/completions` | Completions estilo OpenAI |

### Ejemplo de uso directo (sin OpenCode)

```bash
# Iniciar el router
npm run start

# En otra terminal, hacer una petición
curl http://localhost:4789/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemini",
    "messages": [{"role": "user", "content": "Hola, ¿cómo estás?"}],
    "stream": true
  }'
```

## Licencia

**PolyForm Noncommercial 1.0.0** — ver archivo [LICENSE](LICENSE).

- Uso gratuito para fines no comerciales
- Modificable y distribuible con créditos
- Prohibido uso comercial

Para uso comercial, contactá al autor.

## Autor

**Loonbac21** — [github.com/loonbac](https://github.com/loonbac)
