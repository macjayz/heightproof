{{- define "heightproof.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "heightproof.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "heightproof.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
app.kubernetes.io/name: {{ include "heightproof.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Usage: include "heightproof.selectorLabels" (dict "ctx" $ "component" "api") */}}
{{- define "heightproof.selectorLabels" -}}
app.kubernetes.io/name: {{ include "heightproof.name" .ctx }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "heightproof.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "heightproof.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/* Usage: include "heightproof.image" (dict "ctx" $ "component" "api") */}}
{{- define "heightproof.image" -}}
{{- $img := .ctx.Values.image -}}
{{- printf "%s/%s-%s:%s" $img.registry $img.repository .component (default .ctx.Chart.AppVersion $img.tag) }}
{{- end }}

{{- define "heightproof.secretName" -}}
{{- default (include "heightproof.fullname" .) .Values.auth.existingSecret }}
{{- end }}

{{- define "heightproof.postgresHost" -}}
{{- printf "%s-postgresql" (include "heightproof.fullname" .) }}
{{- end }}

{{- define "heightproof.redisUrl" -}}
{{- if .Values.redis.enabled }}
{{- printf "redis://%s-redis:6379" (include "heightproof.fullname" .) }}
{{- else }}
{{- required "externalRedis.url is required when redis.enabled=false" .Values.externalRedis.url }}
{{- end }}
{{- end }}

{{/*
Reuse a value already stored in the release Secret so generated credentials stay stable across
upgrades. Usage: include "heightproof.secretValue" (dict "ctx" $ "key" "admin-password" "value" "...")
*/}}
{{- define "heightproof.secretValue" -}}
{{- if .value }}
{{- .value }}
{{- else }}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace (include "heightproof.fullname" .ctx) }}
{{- if and $existing (hasKey $existing.data .key) }}
{{- index $existing.data .key | b64dec }}
{{- else }}
{{- randAlphaNum 32 }}
{{- end }}
{{- end }}
{{- end }}

{{- define "heightproof.sharedEnv" -}}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "heightproof.secretName" . }}
      key: database-url
- name: REDIS_URL
  value: {{ include "heightproof.redisUrl" . | quote }}
- name: HEIGHTPROOF_STREAM
  value: {{ .Values.queue.streamName | quote }}
- name: HEIGHTPROOF_GROUP
  value: {{ .Values.queue.groupName | quote }}
{{- end }}

{{/* Writable scratch space for containers running with a read-only root filesystem. */}}
{{- define "heightproof.tmpVolume" -}}
- name: tmp
  emptyDir: {}
{{- end }}

{{- define "heightproof.migrateInitContainer" -}}
{{- if .Values.migrations.enabled }}
- name: migrate
  image: {{ .Values.migrations.image }}
  imagePullPolicy: IfNotPresent
  securityContext:
    {{- toYaml .Values.securityContext | nindent 4 }}
    runAsUser: 70
  env:
    - name: DATABASE_URL
      valueFrom:
        secretKeyRef:
          name: {{ include "heightproof.secretName" . }}
          key: database-url
  command:
    - sh
    - -ec
    - |
      until pg_isready -d "$DATABASE_URL" -q; do echo "waiting for postgres"; sleep 2; done
      { echo "select pg_advisory_lock(424242);"; cat /migrations/*.sql; } \
        | psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -q
      echo "migrations applied"
  volumeMounts:
    - name: migrations
      mountPath: /migrations
      readOnly: true
{{- end }}
{{- end }}

{{- define "heightproof.migrationsVolume" -}}
{{- if .Values.migrations.enabled }}
- name: migrations
  configMap:
    name: {{ include "heightproof.fullname" . }}-migrations
{{- end }}
{{- end }}
