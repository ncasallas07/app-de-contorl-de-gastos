# 💎 FinSmart - Portal Financiero & Asesor de Estrategias

Aplicación web responsiva creada con **React 19 + TypeScript + Vite** y basada en el sistema de diseño **Obsidian Wealth** generado en **Stitch**. Diseñada tanto para escritorio (PC) como para dispositivos móviles (Celular/Tablet).

---

## 🚀 Características Principales

### 1. 💵 Balance & Control Salarial
- Registro de salario mensual y configuración de fecha de cobro.
- Valor generado por cada día laboral (`Salario / Días objetivo`).
- Balance en cuenta en tiempo real en pesos colombianos (`COP $`).

### 2. 📅 Calendario de Jornada Laboral & Días de Gasto
- Calendario interactivo del mes con código de color:
  - 🟢 **Verde esmeralda**: Días trabajados y cotizados.
  - 🔴 **Coral**: Días en los que se realizaron gastos.
  - 🔵 **Azul/Gris**: Días "Cero Gasto" (*No-Spend Days*).
- Haz clic en cualquier día para alternar entre trabajado, descanso o ver el desglose de gastos de esa jornada.

### 3. 💳 Control de Deudas con Alertas de Vencimiento
- Registro de acreedor, saldo pendiente total, cuota mensual, tasa de interés anual (TAE %) y fecha límite de pago.
- **Alertas de urgencia**: Conteo regresivo de días restantes para vencer o aviso de cuotas vencidas.
- **Acciones directas**: Botón para pagar la cuota del mes o liquidar el total de la deuda (con animación de confeti).

### 4. 🐜 Radar de Gastos Hormiga (Fuga de Capital)
- Detección y clasificación de micropagos (café, chucherías, delivery por pereza, suscripciones olvidadas, transporte evitable).
- Cálculo del porcentaje del salario que se esfuma en microgastos.
- Proyección de pérdida anual y **simulador de inversión a 5 años al 8% de interés compuesto**.
- **Reto de 7 Días Cero Gastos Hormiga**.

### 5. 🧠 Asesor Financiero Inteligente (Smart AI Advisor)
- **¿Qué es mejor pagar primero?**:
  - **Método Avalancha**: Prioriza la deuda con mayor tasa de interés (TAE %) para ahorrar dinero en intereses.
  - **Método Bola de Nieve**: Prioriza la deuda con menor saldo para liquidar acreedores rápido y obtener victorias emocionales.
- **¿Qué hacer con tu paga el día que cobras?**:
  - Distribución guiada mediante la regla **50/30/20**:
    - **50% Necesidades**: Vivienda, comida y cuotas mínimas obligatorias.
    - **30% Estilo de vida**: Ocio y salidas con límite estricto.
    - **20% Amortización de deuda y Ahorro**: Directo a la deuda prioritaria.
- **Consejos y Acciones Serias**:
  - Recomendaciones tajantes con niveles de severidad (*Urgente*, *Alta*, *Moderada*).

### 6. 🤖 Agente Coach Financiero (autónomo)
- Corre solo en el servidor de Supabase una vez al día, aunque nadie abra la app.
- Capa 1, agente reactivo: vigila los vencimientos y avisa en la app y por correo.
- Instalación, arquitectura y pruebas en [`supabase/functions/README.md`](supabase/functions/README.md).

---

## 🛠️ Tecnologías Utilizadas

- **Framework**: React 19 + TypeScript.
- **Build tool**: Vite.
- **Estilos**: Sistema de diseño Obsidian Wealth (Glassmorphism, dark theme, paleta esmeralda/coral).
- **Iconografía**: Lucide React.
- **Asistente**: Motor local de lenguaje natural, con integración opcional a Google Gemini.
- **Autenticación**: Supabase Auth con correo y contraseña, recuperación de acceso y sesión persistente.
- **Base de datos**: Supabase Postgres con Row Level Security (RLS), una cuenta privada por usuario.
- **Caché local**: LocalStorage como respaldo de la sesión mientras se sincroniza la nube.

---

## 💻 Cómo Ejecutar Localmente

1. Instalar dependencias:
   ```bash
   npm install
   ```

2. Configurar Supabase:
   - Crea un proyecto en [supabase.com](https://supabase.com).
   - En **Project Settings → API**, copia la URL del proyecto y la clave **anon public**.
   - Crea `.env.local` a partir de `.env.example`:
     ```bash
     cp .env.example .env.local
     ```
     ```env
     VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
     VITE_SUPABASE_ANON_KEY=tu-anon-key
     ```
   - En **SQL Editor**, ejecuta el archivo [`supabase/schema.sql`](supabase/schema.sql). Crea las tablas, políticas RLS y la función de guardado atómico.
   - En **Authentication → URL Configuration**, añade `http://localhost:5173` como Site URL y Redirect URL. Para producción añade también tu dominio.

3. Iniciar servidor de desarrollo:
   ```bash
   npm run dev
   ```
   Abre [http://localhost:5173](http://localhost:5173) en tu navegador (en PC o emulando vista móvil).

4. Compilar para producción:
   ```bash
   npm run build
   ```

5. Revisar el código con el linter:
   ```bash
   npm run lint
   ```

> La contraseña de la base de datos y la clave `service_role` **no** se usan en la web. El frontend solo necesita la URL y la clave pública `anon`. Nunca subas `.env.local` al repositorio.

En producción (Vercel, Netlify, etc.) configura `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en las variables de entorno del hosting, vuelve a desplegar y añade el dominio en **Authentication → URL Configuration** de Supabase.

---

## Gestión de secretos con OpenBao y escaneo con Gitleaks

El proyecto incluye una bóveda local **OpenBao** para dejar de tratar `.env.local` como fuente de verdad y **Gitleaks** para bloquear filtraciones antes de cada commit.

### Requisitos

- Node.js 20 o superior.
- Docker con Docker Compose.
- Git para instalar el hook pre-commit.

### Primer uso

```bash
npm run secrets:up               # inicia OpenBao, lo inicializa y desbloquea
npm run secrets:push             # sube .env.local a OpenBao (KV v2)
npm run secrets:pull -- --force  # materializa el secreto en .env.local
npm run secrets:list             # lista claves sin mostrar valores
npm run secrets:diff             # compara .env.local con OpenBao
```

- El secreto se guarda en `secret/data/finsmart/app`. Puedes cambiarlo con `OPENBAO_SECRET_PATH`, `OPENBAO_KV_MOUNT`, `OPENBAO_ADDR` y `OPENBAO_TOKEN`.
- `.openbao/init.json` contiene las claves de unseal y el root token; queda ignorado por Git y se crea con permisos `0600` en sistemas POSIX (en Windows/WSL aplican las ACL de Windows). **Guarda una copia fuera del proyecto**: sin esas claves no se puede desbloquear la bóveda.
- No guardes `OPENBAO_TOKEN` ni `BAO_TOKEN` dentro de `.env.local`.
- Para actualizar una clave usa `npm run secrets:set -- CLAVE=valor` o, para evitar el historial del shell, `printf '%s' 'valor' | npm run secrets:set -- --stdin CLAVE`. Añade `--sync` para reflejarla también en `.env.local`.
- `npm run secrets:down` detiene OpenBao conservando los datos; `npm run secrets:down -- --volumes` elimina también el volumen.
- Las variables `VITE_*` se incrustan en el bundle del navegador. No pongas ahí claves privilegiadas: `VITE_GEMINI_API_KEY` queda visible para cualquier usuario de la app, así que para producción usa un backend que actúe de proxy.
- Este compose es solo para desarrollo local. En producción usa un OpenBao con TLS, políticas de mínimo privilegio y un token de solo lectura para la aplicación.

### Escaneo de secretos

```bash
npm run secrets:scan          # historial Git si hay commits; directorio si no hay repositorio o está vacío
npm run secrets:scan:dir      # escanea los archivos del directorio
npm run secrets:scan:staged   # escanea solo los cambios en staging
npm run secrets:scan:history  # escanea todo el historial Git
npm run secrets:install-hooks # instala el hook pre-commit
npm run secrets:doctor        # revisa .gitignore, permisos, Git y OpenBao
```

Gitleaks se descarga automáticamente en `.tools/` (ignorado por Git) si no está en el `PATH`. También puedes definir `GITLEAKS_BIN` o `GITLEAKS_VERSION`.

El hook [`.githooks/pre-commit`](.githooks/pre-commit) ejecuta `secrets:scan:staged` y bloquea commits con secretos. Si el proyecto aún no es un repositorio Git, ejecuta `git init` antes de `npm run secrets:install-hooks`. Las reglas personalizadas de [`.gitleaks.toml`](.gitleaks.toml) cubren claves `sb_secret_`, tokens `sbp_` y `service_role` de Supabase, tokens de OpenBao y claves de Gemini.

> Si un secreto ya se subió alguna vez, eliminarlo del archivo no basta: **rótalo** en el proveedor y limpia el historial antes de volver a publicar.

## Despliegue en GitHub Pages y autenticación por correo

URL pública del proyecto:

**https://juan-esteban-sarmiento.github.io/app-de-contorl-de-gastos/**

Para compilar y publicar una actualización en la rama `gh-pages`:

```bash
VITE_BASE_PATH=/app-de-contorl-de-gastos/ npm run build
cp dist/index.html dist/404.html
npx gh-pages -d dist --branch gh-pages
```

En GitHub, la publicación debe estar configurada en **Settings → Pages → Build and deployment → Deploy from a branch**, rama `gh-pages`, carpeta `/ (root)`.

### Configuración de Supabase Auth

En el panel del proyecto `ewiksyqyylztjzngkfxu`:

1. **Authentication → URL Configuration**
   - **Site URL:** `https://juan-esteban-sarmiento.github.io/app-de-contorl-de-gastos/`
   - **Redirect URLs:**
     - `https://juan-esteban-sarmiento.github.io/app-de-contorl-de-gastos/**`
     - `http://localhost:5173/**`
     - `http://127.0.0.1:5173/**`
2. **Authentication → Providers → Email**
   - Activa **Email**.
   - Activa **Confirm email** si quieres verificar el correo antes de permitir el acceso.
3. **Authentication → Emails / SMTP**
   - El correo integrado de Supabase solo sirve para pruebas: permite 2 envíos por hora y solo envía a miembros del equipo del proyecto.
   - Para probar con tu propio correo, añade tu dirección al equipo de la organización o configura un SMTP propio (Resend, Brevo, etc.). Para producción, usa un SMTP propio con dominio verificado.

Los enlaces de confirmación y recuperación usan la URL base del despliegue; tras cambiar el **Site URL** o los **Redirect URLs**, vuelve a solicitar el correo para probar.

### Autenticación

- Registro e inicio de sesión con correo y contraseña.
- Recuperación de contraseña mediante enlace enviado por Supabase.
- Si la confirmación de correo está activada en Supabase, el usuario debe confirmar antes de entrar.
- Al cerrar sesión se limpian los datos financieros y el chat del navegador.

### Asistente con Gemini (opcional)

El asistente funciona sin conexión con su motor local. Para usar Gemini, pega una clave de Google AI Studio desde el botón de la llave en el chat, o define `VITE_GEMINI_API_KEY` en un archivo `.env.local` (ignorado por Git).
