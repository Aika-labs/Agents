# Arquitectura del Proyecto -- Agent OS

Referencia técnica para desarrolladores. Describe la estructura completa del código, qué hace cada módulo, y qué falta por implementar.

**Última actualización:** Febrero 2026

---

## Estadísticas del Código

| Área | Archivos | Líneas de Código |
|------|----------|------------------|
| Control Plane API | 32 | ~10,350 |
| Agent Runtime | 19 | ~1,870 |
| Protocols Service | 12 | ~1,980 |
| Dashboard (Next.js) | 52 | ~7,530 |
| Infraestructura (Pulumi) | 1 | 638 |
| Migraciones de BD | 17 | ~2,155 |
| CI/CD Workflows | 2 | ~780 |
| **Total** | **~135** | **~25,300** |

---

## Estructura del Proyecto

```
Agents/
│
├── services/
│   │
│   ├── control-plane/                  # API central (Hono, puerto 8080)
│   │   ├── src/
│   │   │   ├── app.ts                  # Punto de entrada Hono: monta middleware + rutas
│   │   │   ├── index.ts                # Servidor HTTP + graceful shutdown
│   │   │   │
│   │   │   ├── routes/                 # 15 módulos de rutas (80+ endpoints)
│   │   │   │   ├── agents.ts           # CRUD agentes (POST/GET/PATCH/DELETE /agents)
│   │   │   │   ├── sessions.ts         # CRUD sesiones (/sessions)
│   │   │   │   ├── memory.ts           # Memoria vectorial (/agents/:id/memories, /search)
│   │   │   │   ├── permissions.ts      # RBAC (/agents/:id/permissions)
│   │   │   │   ├── hitl.ts             # Human-in-the-loop: políticas + aprobaciones
│   │   │   │   ├── evals.ts            # Evaluaciones: suites, cases, runs
│   │   │   │   ├── pipelines.ts        # Data pipelines: conectores, pasos, ejecuciones
│   │   │   │   ├── templates.ts        # Templates + versiones + deployments
│   │   │   │   ├── analytics.ts        # Métricas por agente + dashboard del owner
│   │   │   │   ├── webhooks.ts         # Suscripciones + entregas con HMAC-SHA256
│   │   │   │   ├── batch.ts            # Operaciones masivas (crear/actualizar/eliminar)
│   │   │   │   ├── feature-flags.ts    # Feature flags con rollout y targeting
│   │   │   │   ├── audit.ts            # Logs de auditoría
│   │   │   │   └── health.ts           # Health checks (liveness, readiness, metrics)
│   │   │   │
│   │   │   ├── lib/                    # 16 módulos de lógica de negocio
│   │   │   │   ├── analytics.ts        # Queries de métricas y agregaciones
│   │   │   │   ├── audit.ts            # Escritura de logs de auditoría
│   │   │   │   ├── batch.ts            # Lógica de operaciones masivas
│   │   │   │   ├── cache.ts            # Cache en Redis con TTL configurable
│   │   │   │   ├── evals.ts            # Lógica de evaluaciones (6 tipos de scorer)
│   │   │   │   ├── hitl.ts             # Lógica de aprobaciones y políticas HITL
│   │   │   │   ├── logger.ts           # Logger estructurado (pino)
│   │   │   │   ├── memory.ts           # Memoria vectorial con pgvector
│   │   │   │   ├── metrics.ts          # Recolección de métricas Prometheus
│   │   │   │   ├── permissions.ts      # Verificación de permisos RBAC
│   │   │   │   ├── pipeline.ts         # Lógica de data pipelines
│   │   │   │   ├── redis.ts            # Cliente Redis singleton
│   │   │   │   ├── supabase.ts         # Cliente Supabase singleton
│   │   │   │   ├── templates.ts        # Lógica de templates y versionado
│   │   │   │   ├── validate.ts         # Validación con Zod
│   │   │   │   └── webhooks.ts         # Despacho de webhooks con reintentos
│   │   │   │
│   │   │   ├── middleware/             # 7 capas de middleware (orden importa)
│   │   │   │   ├── request-id.ts       # 1. Genera/propaga X-Request-Id
│   │   │   │   ├── trace.ts            # 2. Contexto de traza OpenTelemetry
│   │   │   │   ├── security-headers.ts # 3. HSTS, CSP, X-Frame-Options
│   │   │   │   ├── rate-limit.ts       # 4. Rate limit por IP (100/min) y por usuario (200/min)
│   │   │   │   ├── api-key.ts          # 5. Autenticación por API key (X-API-Key)
│   │   │   │   ├── auth.ts             # 6. Autenticación JWT (Bearer token)
│   │   │   │   └── error-handler.ts    # 7. Manejo global de errores
│   │   │   │
│   │   │   └── types/
│   │   │       ├── database.ts         # Tipos TypeScript para las 30+ tablas de Supabase
│   │   │       └── env.ts              # Tipo del entorno Hono (Variables tipadas)
│   │   │
│   │   ├── Dockerfile                  # Build multi-stage para Cloud Run
│   │   ├── vitest.config.ts            # Configuración de tests
│   │   ├── package.json                # Dependencias: hono, @supabase/supabase-js, ioredis, zod, pino
│   │   └── .env.example                # Variables de entorno requeridas
│   │
│   ├── agent-runtime/                  # Motor de ejecución de agentes (Hono, puerto 8081)
│   │   ├── src/
│   │   │   ├── app.ts                  # Servidor Hono con rutas de ejecución
│   │   │   ├── index.ts                # Entry point + graceful shutdown
│   │   │   │
│   │   │   ├── frameworks/             # 6 adaptadores de frameworks + registro
│   │   │   │   ├── types.ts            # Interfaz FrameworkAdapter (137 LOC)
│   │   │   │   ├── registry.ts         # Registro dinámico de adaptadores
│   │   │   │   ├── runner.ts           # Dispatcher: recibe agente → elige adaptador → ejecuta
│   │   │   │   ├── google-adk.ts       # Adaptador Google ADK
│   │   │   │   ├── langgraph.ts        # Adaptador LangGraph
│   │   │   │   ├── crewai.ts           # Adaptador CrewAI
│   │   │   │   ├── autogen.ts          # Adaptador AutoGen
│   │   │   │   ├── openai-sdk.ts       # Adaptador OpenAI SDK
│   │   │   │   └── custom.ts           # Adaptador para runtimes personalizados
│   │   │   │
│   │   │   ├── lifecycle/              # Gestión del ciclo de vida de agentes
│   │   │   │   ├── manager.ts          # Spawn, monitor, stop, cleanup (basado en procesos)
│   │   │   │   └── instance.ts         # Tipo de instancia de agente en ejecución
│   │   │   │
│   │   │   ├── redis/                  # Comunicación en tiempo real
│   │   │   │   ├── client.ts           # Cliente Redis singleton
│   │   │   │   └── events.ts           # Event bus para sincronización de estado
│   │   │   │
│   │   │   ├── routes/
│   │   │   │   └── agents.ts           # Endpoints de ejecución de agentes
│   │   │   │
│   │   │   └── k8s-reference/          # [ABANDONADO] Referencia de Kubernetes
│   │   │       ├── lifecycle.ts.bak    # Gestión de pods (no activo)
│   │   │       └── manifests.ts.bak    # Generación de manifiestos K8s (no activo)
│   │   │
│   │   ├── Dockerfile
│   │   └── vitest.config.ts
│   │
│   └── protocols/                      # Servicio de protocolos inter-agente (Hono, puerto 8082)
│       ├── src/
│       │   ├── app.ts                  # Servidor Hono con rutas A2A + MCP
│       │   ├── index.ts                # Entry point + graceful shutdown
│       │   │
│       │   ├── a2a/                    # Protocolo Agent-to-Agent
│       │   │   ├── agent-card.ts       # Descubrimiento de agentes (Agent Card spec)
│       │   │   ├── auth.ts             # Autenticación JWT entre agentes
│       │   │   ├── client.ts           # Cliente A2A (enviar tareas, recibir resultados)
│       │   │   ├── executor.ts         # Ejecutor de tareas delegadas
│       │   │   └── server.ts           # Servidor A2A (recibir tareas entrantes)
│       │   │
│       │   └── mcp/                    # Model Context Protocol
│       │       ├── client.ts           # Cliente MCP (registrar herramientas, compartir contexto)
│       │       └── server.ts           # Servidor MCP (exponer herramientas, negociar capacidades)
│       │
│       ├── Dockerfile
│       └── vitest.config.ts
│
├── dashboard/                          # Frontend Next.js 15 (Vercel + Cloud Run)
│   ├── src/
│   │   ├── app/                        # 22 rutas (App Router)
│   │   │   ├── page.tsx                # Landing page (hero, features, stats, CTA)
│   │   │   ├── layout.tsx              # Layout raíz (fonts, metadata, AuthProvider)
│   │   │   ├── globals.css             # Tailwind CSS 4 + tema shadcn/ui (light/dark)
│   │   │   │
│   │   │   ├── login/
│   │   │   │   └── page.tsx            # Login con Supabase Auth (email/password)
│   │   │   │
│   │   │   ├── auth/
│   │   │   │   └── callback/
│   │   │   │       └── route.ts        # Callback OAuth de Supabase
│   │   │   │
│   │   │   └── dashboard/
│   │   │       ├── layout.tsx          # Layout del dashboard (sidebar + contenido)
│   │   │       ├── page.tsx            # Overview: stats cards, actividad reciente
│   │   │       │
│   │   │       ├── agents/
│   │   │       │   ├── page.tsx        # Lista de agentes (tabla con status, framework)
│   │   │       │   └── [id]/
│   │   │       │       ├── layout.tsx  # Layout de detalle con tabs de navegación
│   │   │       │       ├── page.tsx    # Detalle del agente (config, model, tools)
│   │   │       │       ├── approvals/page.tsx    # Solicitudes de aprobación HITL
│   │   │       │       ├── deployments/page.tsx  # Historial de deployments
│   │   │       │       ├── evals/page.tsx        # Suites y runs de evaluación
│   │   │       │       ├── memory/page.tsx       # Memorias vectoriales del agente
│   │   │       │       ├── permissions/page.tsx  # Permisos RBAC del agente
│   │   │       │       ├── pipelines/page.tsx    # Data pipelines del agente
│   │   │       │       └── webhooks/page.tsx     # Webhooks del agente
│   │   │       │
│   │   │       ├── sessions/
│   │   │       │   ├── page.tsx        # Lista de sesiones
│   │   │       │   └── [id]/page.tsx   # Detalle con timeline de mensajes
│   │   │       │
│   │   │       ├── analytics/page.tsx  # Gráficas de uso, tokens, costos
│   │   │       ├── audit-logs/page.tsx # Logs de auditoría con filtros
│   │   │       ├── feature-flags/page.tsx # Gestión de feature flags
│   │   │       ├── settings/page.tsx   # Configuración de la cuenta
│   │   │       │
│   │   │       └── templates/
│   │   │           ├── page.tsx        # Lista de templates
│   │   │           └── [id]/page.tsx   # Detalle del template + versiones
│   │   │
│   │   ├── components/
│   │   │   ├── auth-provider.tsx       # Context de auth (Supabase o demo user sintético)
│   │   │   ├── sidebar.tsx             # Navegación lateral del dashboard
│   │   │   └── ui/                     # 21 componentes shadcn/ui
│   │   │       ├── avatar.tsx, badge.tsx, button.tsx, calendar.tsx
│   │   │       ├── card.tsx, command.tsx, dialog.tsx, dropdown-menu.tsx
│   │   │       ├── input.tsx, label.tsx, popover.tsx, progress.tsx
│   │   │       ├── scroll-area.tsx, select.tsx, separator.tsx, sheet.tsx
│   │   │       ├── switch.tsx, table.tsx, tabs.tsx, textarea.tsx
│   │   │       └── tooltip.tsx
│   │   │
│   │   └── lib/
│   │       ├── api.ts                  # Cliente API completo (534 LOC, 23 módulos exportados)
│   │       ├── types.ts                # Tipos TypeScript del frontend (469 LOC)
│   │       ├── utils.ts                # Utilidades (cn para clases CSS)
│   │       └── supabase/
│   │           ├── client.ts           # Cliente Supabase para el browser
│   │           └── server.ts           # Cliente Supabase para Server Components
│   │
│   ├── public/                         # Assets estáticos (SVGs)
│   ├── Dockerfile                      # Build standalone para Cloud Run (DOCKER_BUILD=1)
│   ├── vercel.json                     # Detección de framework para Vercel
│   ├── next.config.ts                  # Output condicional: standalone (Docker) o default (Vercel)
│   ├── package.json                    # next 15, react 19, tailwindcss 4, shadcn/ui, lucide-react
│   ├── tsconfig.json
│   ├── eslint.config.mjs
│   ├── postcss.config.mjs
│   └── components.json                 # Configuración de shadcn/ui
│
├── infra/                              # Infraestructura como Código (Pulumi, TypeScript, GCP)
│   ├── index.ts                        # Programa principal (638 LOC)
│   │   │
│   │   │  Recursos provisionados:
│   │   │  ├── APIs de GCP habilitadas (8 servicios)
│   │   │  ├── VPC + Subnet (10.0.0.0/20, acceso privado a Google)
│   │   │  ├── 4 Service Accounts (control-plane, agent-runtime, protocols, dashboard)
│   │   │  ├── IAM roles con privilegio mínimo por SA
│   │   │  ├── Artifact Registry (Docker, cleanup 7 días sin tag)
│   │   │  ├── Cloud Run v2 x4 (control-plane:8080, runtime:8081, protocols:8082, dashboard:3000)
│   │   │  ├── Redis 7.2 (BASIC dev / STANDARD_HA prod)
│   │   │  ├── Cloud Storage x2 (artifacts 90d + log archive 365d)
│   │   │  ├── Secret Manager x2 (Supabase URL + key)
│   │   │  ├── Log Sink → Cloud Storage
│   │   │  └── Alert Policies x2 (latencia p99 > 5s, tasa 5xx > 5%)
│   │   │
│   ├── Pulumi.yaml                     # Proyecto: agents-platform, runtime nodejs
│   ├── Pulumi.dev.yaml                 # Config del stack dev (gcp:project, gcp:region)
│   ├── package.json                    # @pulumi/pulumi, @pulumi/gcp
│   └── tsconfig.json
│
├── supabase/                           # Capa de datos (PostgreSQL + pgvector)
│   ├── config.toml                     # Configuración del proyecto Supabase
│   ├── seed.sql                        # Datos de desarrollo (seed)
│   └── migrations/                     # 17 migraciones secuenciales
│       ├── 00001_extensions.sql        # uuid-ossp, pgvector, moddatetime
│       ├── 00002_agents.sql            # Tabla agents (definición core)
│       ├── 00003_sessions.sql          # agent_sessions, agent_messages
│       ├── 00004_wallets.sql           # agent_wallets, wallet_transactions
│       ├── 00005_features.sql          # feature_flags
│       ├── 00006_audit.sql             # audit_logs
│       ├── 00007_marketplace.sql       # marketplace_listings, marketplace_reviews
│       ├── 00008_rls.sql               # Políticas de Row-Level Security
│       ├── 00009_memory.sql            # agent_memories (con pgvector)
│       ├── 00010_permissions.sql       # agent_permissions (RBAC)
│       ├── 00011_hitl.sql              # hitl_policies, approval_requests
│       ├── 00012_evals.sql             # eval_suites, eval_cases, eval_runs, eval_results
│       ├── 00013_data_pipeline.sql     # data_connectors, data_pipelines, pipeline_steps, pipeline_runs
│       ├── 00014_creation_layer.sql    # agent_templates, template_versions, agent_deployments
│       ├── 00015_analytics.sql         # agent_metrics, agent_usage_daily
│       ├── 00016_webhooks.sql          # agent_webhooks, webhook_deliveries
│       └── 00017_api_keys.sql          # api_keys
│
├── .github/workflows/
│   ├── ci.yml                          # PR: detección de cambios, lint/typecheck/test por servicio, Pulumi preview
│   └── deploy.yml                      # Merge a main: Docker build+push, Cloud Run deploy, migraciones, Pulumi up
│
├── README.md                           # Documentación general del proyecto
├── ARCHITECTURE.md                     # Este archivo
└── LICENSE
```

---

## Lo Que Falta / Brechas

### Crítico (bloquea uso en producción)

1. **Sin clúster GKE** -- El README dice que los agentes corren en GKE Autopilot, pero la infraestructura solo provisiona Cloud Run. El directorio `k8s-reference/` tiene archivos `.bak` (`lifecycle.ts.bak`, `manifests.ts.bak`), lo que sugiere que el soporte de Kubernetes fue planeado pero abandonado. El runtime usa ejecución basada en procesos en su lugar.

2. **Sin ejecución real de agentes** -- Los adaptadores de frameworks (Google ADK, LangGraph, etc.) son scaffolding estructural. Definen interfaces y simulan el flujo de ejecución pero no llaman a ninguna API de LLM ni ejecutan código real de agentes. El `runner.ts` despacha a los adaptadores pero estos retornan respuestas placeholder.

3. **Variables de entorno / secretos no conectados** -- Los servicios de Cloud Run usan imágenes placeholder (`us-docker.pkg.dev/cloudrun/container/hello`). Los secretos de Supabase se crean pero no se les agregan versiones. La URL de Redis no se inyecta en los servicios. El control plane no recibe `REDIS_URL` ni las variables `SUPABASE_*` en la configuración de Pulumi.

4. **Dashboard es solo lectura** -- Todas las páginas renderizan estados vacíos y manejan errores de API correctamente, pero no hay formularios de creación/edición, ni botones de mutación que funcionen. El cliente API tiene todos los métodos pero la UI solo llama a endpoints de `list` y `get`.

5. **Sin tests para el servicio de protocolos** -- `server.test.ts` tiene solo 22 líneas (placeholder). Los tests de auth y executor de A2A existen pero son básicos.

### Importante (necesario para un deployment real)

6. **Sin ambientes staging/prod** -- Solo existe el stack `dev`. El workflow de deploy tiene hardcodeado `ENVIRONMENT: dev`. No hay pipeline de promoción entre ambientes.

7. **Sin dominio personalizado ni load balancer** -- Los servicios de Cloud Run usan URLs auto-generadas. No hay Cloud Load Balancing, ni certificados SSL, ni CDN.

8. **Sin VPC connector** -- El workflow de deploy referencia un conector `agents-vpc` pero la infraestructura no lo crea. Los servicios de Cloud Run no pueden alcanzar Redis sin él.

9. **Sin conexión a Supabase en el runtime** -- El agent runtime y el servicio de protocolos no tienen configuración de cliente Supabase. No pueden leer/escribir datos de agentes.

10. **Rutas del marketplace faltantes** -- Las tablas de base de datos existen (`marketplace_listings`, `marketplace_reviews`) pero no hay rutas de API ni páginas en el dashboard para el marketplace.

11. **Rutas de wallets/financiero faltantes** -- Las tablas de base de datos existen (`agent_wallets`, `wallet_transactions`) pero no hay rutas de API.

12. **Sin WebSocket/SSE para tiempo real** -- Las sesiones y la ejecución de agentes se beneficiarían de streaming, pero todo es request/response.

13. **Sin canales de notificación en alertas** -- Las políticas de alerta de monitoreo existen pero no tienen canales de notificación configurados (ni email, ni Slack, ni PagerDuty).

### Deseable

14. **Sin toggle de dark mode** -- Las variables CSS para dark mode existen pero no hay un switcher de tema en la UI.

15. **Sin paginación** -- Las rutas de API retornan todos los resultados sin limit/offset.

16. **Sin búsqueda/filtros** -- Las listas del dashboard no tienen controles de búsqueda ni filtros.

17. **Sin tests E2E** -- No hay tests de Playwright/Cypress para el dashboard.

18. **Sin spec OpenAPI** -- No hay documentación de API auto-generada.

19. **Tipos de base de datos manuales** -- Un comentario dice "generar con supabase gen types" pero se mantienen a mano.

20. **Sin endpoint de health en protocolos** -- El workflow de deploy verifica `/health` pero el servicio de protocolos podría no tenerlo.

---

## Resumen

El proyecto es un monorepo bien arquitectado con un diseño de esquema completo (30+ tablas), una superficie de API REST completa (80+ endpoints), y una UI de dashboard pulida. La calidad del código es alta: TypeScript consistente, tipado correcto, buena separación de responsabilidades, y una cadena de middleware bien pensada.

La brecha principal es **profundidad vs. amplitud**: la plataforma cubre una superficie impresionante pero la mayoría de las features son scaffolding estructural en lugar de implementaciones funcionales. Los adaptadores de frameworks no ejecutan agentes reales, el dashboard no puede crear ni editar recursos, y la infraestructura le faltan piezas clave (VPC connector, GKE, conexión de secretos) necesarias para correr en producción.
