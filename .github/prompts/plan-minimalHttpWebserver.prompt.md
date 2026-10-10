## Plan : serveur HTTP minimal

Créer dans [src/Webserver.ts](src/Webserver.ts) un serveur basé sur `node:http`, avec `start()` et `stop()`, et une seule route `GET /rates/:sourceCurrency/:destCurrency`.

**Étapes**
1. Injecter la configuration existante et le cas d’usage `GetExchangeRate` dans le serveur.
2. Valider les devises sans tenir compte de la casse, puis les normaliser vers les valeurs de `Currencies` (`EUR`, `USD`, `GBP`). Renvoyer `400` si elles ne sont pas supportées, `404` pour une route inconnue et `405` pour une autre méthode.
3. Raccorder le démarrage et l’arrêt du serveur dans [src/main.ts](src/main.ts). Convertir aussi les ports configurés en nombres: les valeurs par défaut de [config/default.json](config/default.json) sont des chaînes.


**Vérification**
Tester le serveur sur un port éphémère, puis lancer `npm test` et `npm run build`.

Le serveur de simulation dans [src/interfaces/http/server.ts](src/interfaces/http/server.ts) servira de référence pour le routage et les réponses JSON, sans être réutilisé directement. Aucun framework ni nouvelle dépendance n’est nécessaire.