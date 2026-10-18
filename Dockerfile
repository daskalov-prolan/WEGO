# One image for the whole application: the API serves the React build from wwwroot,
# so browser and API share one origin and the login cookie needs no CORS.

# 1. React build
FROM node:24-slim AS web
WORKDIR /web
COPY src/Wego.Web/package.json src/Wego.Web/package-lock.json ./
RUN npm ci
COPY src/Wego.Web/ ./
RUN npm run build

# 2. API build
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS api
WORKDIR /src
COPY src/Wego.Api/Wego.Api.csproj src/Wego.Api/
RUN dotnet restore src/Wego.Api/Wego.Api.csproj
COPY src/Wego.Api/ src/Wego.Api/
RUN dotnet publish src/Wego.Api/Wego.Api.csproj -c Release -o /app --no-restore

# 3. Runtime
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=api /app ./
COPY --from=web /web/dist ./wwwroot

# Folder for the keys of the login cookie; a volume is mounted here and takes over the owner.
RUN mkdir -p /var/lib/wego/keys && chown "$APP_UID" /var/lib/wego/keys

ENV ASPNETCORE_HTTP_PORTS=8080 \
    DataProtection__KeysPath=/var/lib/wego/keys
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Wego.Api.dll"]
