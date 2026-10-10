## Plan : serveur HTTP simulé de taux

Créer un serveur TypeScript autonome avec `node:http`, sans framework. Il exposera `GET /rates/CURRENCY_SOURCE/CURRENCY_DEST`, générera un taux fictif stable et simulera différents comportements configurés au démarrage.

**Étapes**
1. Définir une configuration typée, injectée dans `createRateServer(config)`, avec `HOST`, `PORT`, `SIMULATION_MODE` et `SIMULATION_DELAY_MS`. Modes prévus : `normal`, `slow`, `http-500`, `unavailable`, `timeout` et `invalid`.
2. Ajouter dans `src/domain/exchange-rate.ts` la validation des codes devise (trois lettres ASCII) et le calcul d’un taux positif, déterministe pour chaque paire. Une devise convertie vers elle-même donne `1`.
3. Implémenter le routage dans `src/interfaces/http/server.ts` avec le module natif `node:http`. La réponse normale sera `{ "rate": number }`. Prévoir des erreurs JSON pour les codes invalides (`400`), les routes inconnues (`404`) et les méthodes non prises en charge (`405`).
4. Simuler les pannes : `slow` attend puis répond ; `http-500` renvoie une erreur HTTP ; `unavailable` coupe la connexion ; `timeout` laisse la requête ouverte jusqu’à l’abandon du client ; `invalid` renvoie un corps JSON invalide.
5. Ajouter dans `src/infrastructure/providers/provider-a.ts` pour lire et valider la configuration, démarrer le serveur et gérer son arrêt. Ajouter des scripts `dev` et `start` dans `package.json`. Déclarer `@types/node` en dépendance de développement si nécessaire, sans ajouter de dépendance HTTP à l’exécution.
6. Remplacer le test smoke existant dans `src/infrastructure/providers/__tests__/provider-a.test.ts` par des tests HTTP locaux couvrant le contrat, les erreurs et chaque mode. Utiliser un port éphémère et fermer les serveurs et requêtes dans tous les cas.
7. Documenter le lancement, la configuration, les modes de simulation et des exemples `curl` dans `README.md`.

**Vérification**
1. `npm test` pour les tests d’intégration, y compris les simulations de panne.
2. `npm run lint`.
3. `npm run build`, puis vérification manuelle du serveur compilé avec `curl`.
4. Confirmer qu’aucun framework HTTP ni dépendance de résilience n’a été ajouté.

**Périmètre**
Le choix confirmé est un serveur simulé seul, configuré au démarrage. Les taux sont fictifs et déterministes. L’agrégateur A/B, le cache et les patterns Retry, Circuit Breaker, Rate Limiting et Bulkhead restent hors de cette mission.

À noter : le dépôt présente déjà des erreurs TypeScript dans les modules de résilience (`Bulkhead`, `RateLimiter`, `Retry` et leur index). Elles sont hors périmètre ; le build global peut donc échouer indépendamment du serveur.