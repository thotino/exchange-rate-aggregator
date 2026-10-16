# DECISIONS ARCHITECTURALES
## Retry
Le pattern de retry contrôle le timeout de chaque tentative. Et les timeouts sont rejoués.

Si `retry-after` est plus long que `maxDelay`, mieux vaut abandonner le retry. Le maxDelay est une sorte de SLA que je passe avec mon client.

* Ajouter un timeout global au niveau de la requête métier: il s'agit d'une deadline qui encadre l'ensemble de la requête métier et ne pas être confondu avec le timeout par tentative de retry.
Ce timeout global garantit que la requête métier respecte une écheance maximale.
## Circuit breaker
Décider quelles erreurs déclenchent l'ouverture du disjoncteur.
Traiter le problème de la concurrence si plusieurs requêtes arrivent au moment où le circuit est ouvvert. J'utilise une coalescence de requêtes mais au niveau du client et non pas au niveau du circuit breaker.

## Comment composer les patterns?
L'ordre de Resilience4j:
```text
Retry ( CircuitBreaker ( RateLimiter ( TimeLimiter ( Bulkhead ( Function ) ) ) ) )
```
https://resilience4j.readme.io/docs/getting-started-3#aspect-order