Oui. J’ai parcouru la série : elle couvre **Retry, Timeout, Circuit Breaker, Rate Limiting, Bulkhead**, puis **Chaos Engineering** pour vérifier le comportement du système en situation de panne. ([Antoine Coulon][1])

Je te propose un exercice volontairement **petit fonctionnellement**, mais suffisamment riche techniquement pour que les patterns aient un vrai intérêt.

## Énoncé : un agrégateur de taux de change résilient

Tu dois développer une API Node.js/TypeScript qui permet à un client d'obtenir le **taux de change d'une devise vers une autre**.

L'application ne possède pas elle-même les taux de change. Elle interroge **deux fournisseurs externes** :

```text
                ┌─────────────────┐
                │   Client HTTP   │
                └────────┬────────┘
                         │
                         ▼
                ┌─────────────────┐
                │ Currency API    │
                │   Node.js/TS    │
                └───────┬─────────┘
                        │
                ┌───────┴────────┐
                │                │
                ▼                ▼
        ┌──────────────┐  ┌──────────────┐
        │ Provider A   │  │ Provider B   │
        │ Exchange API │  │ Exchange API │
        └──────────────┘  └──────────────┘
```

L'objectif principal n'est **pas** de construire un convertisseur de devises sophistiqué.
L'objectif est de construire une API qui **continue à fonctionner malgré les problèmes de ses dépendances externes**.

### API exposée

Une seule route suffit :

```http
GET /rates/EUR/USD
```

Réponse normale :

```json
{
  "from": "EUR",
  "to": "USD",
  "rate": 1.17,
  "provider": "provider-a"
}
```

---

# Contraintes fonctionnelles

Le système doit obtenir le taux auprès d'un fournisseur externe.

Les fournisseurs sont volontairement simulés par deux petits serveurs HTTP que tu développeras également :

```text
provider-a
provider-b
```

Ils doivent pouvoir simuler différents comportements :

* réponse normale ;
* réponse lente ;
* erreur HTTP 500 ;
* timeout ;
* indisponibilité ;
* réponse invalide.

Par exemple :

```http
GET http://provider-a/rates/EUR/USD
```

peut répondre :

```json
{
  "rate": 1.17
}
```

ou, en mode simulation de panne :

```text
500 Internal Server Error
```

ou simplement mettre 10 secondes à répondre.

---

# Les contraintes de résilience

C'est ici que l'exercice devient intéressant.

### 1. Retry

Une erreur temporaire du fournisseur ne doit pas immédiatement provoquer l'échec de la requête.

Exemple :

```text
Provider A
    │
    ├── 500
    │
    ├── retry → 500
    │
    ├── retry → 200
    │
    └── succès
```

Le retry devra utiliser un **backoff exponentiel avec jitter**.

Tu devras notamment décider :

* quelles erreurs sont retryables ;
* combien de tentatives ;
* quel délai maximum ;
* comment éviter que tous les clients retryent simultanément.

C'est directement le problème abordé dans l'article sur le Retry. ([Antoine Coulon][2])

---

### 2. Timeout

Un fournisseur qui ne répond plus ne doit jamais immobiliser indéfiniment une ressource de ton application.

Par exemple :

```text
Provider A
     │
     │───────────────X
     │               2s
     │
     └── TIMEOUT
```

Tu dois définir un timeout, par exemple :

```text
2 secondes
```

et décider ce qui arrive ensuite.

---

### 3. Circuit Breaker

Si Provider A est en panne depuis suffisamment longtemps, ton application ne doit plus essayer de l'appeler à chaque requête.

Le circuit doit avoir les états classiques :

```text
             failures
        ┌─────────────────┐
        │                 ▼
     CLOSED ───────────► OPEN
        ▲                  │
        │                  │ timeout
        │                  ▼
        └──────────── HALF-OPEN
                success
```

Par exemple :

```text
5 erreurs consécutives
        ↓
OPEN pendant 10 secondes
        ↓
une requête de test
        ↓
success → CLOSED
failure → OPEN
```

Tu devras déterminer les paramètres et leur justification.

L'article de la série décrit justement le Circuit Breaker autour de ces états `CLOSED / OPEN / HALF-OPEN`. ([Antoine Coulon][2])

---

### 4. Rate Limiting

Ton API doit également se protéger contre un client qui envoie trop de requêtes.

Par exemple :

```text
100 requêtes / minute / client
```

Au-delà :

```http
429 Too Many Requests
```

Tu devras choisir une stratégie :

* Fixed Window
* Sliding Window
* Token Bucket
* autre

et expliquer pourquoi.

---

### 5. Bulkhead

Imagine maintenant que Provider A soit extrêmement lent.

Sans protection :

```text
Request 1 ──► Provider A ────────────
Request 2 ──► Provider A ────────────
Request 3 ──► Provider A ────────────
Request 4 ──► Provider A ────────────
...
Request 100 ─► Provider A ───────────
```

Toutes les ressources de ton application peuvent progressivement être consommées par Provider A.

Tu dois donc **isoler les ressources consacrées aux appels externes**.

Par exemple :

```text
                   Currency API
                       │
              ┌────────┴────────┐
              │                 │
         Bulkhead A        Bulkhead B
         max 10 calls      max 10 calls
              │                 │
              ▼                 ▼
         Provider A        Provider B
```

Si les 10 slots de Provider A sont occupés, une nouvelle requête ne doit pas pouvoir dégrader Provider B.

C'est précisément l'objectif du Bulkhead décrit dans la série. ([Antoine Coulon][2])

---

# Et surtout : le fallback

Pour rendre l'exercice vraiment intéressant, ajoute cette règle :

> **Si Provider A échoue, l'application doit essayer Provider B.**

Puis :

> **Si les deux fournisseurs échouent, l'application peut utiliser un taux mis en cache datant de moins de 5 minutes.**

On obtient alors :

```text
                   ┌─────────────┐
                   │ Provider A  │
                   └──────┬──────┘
                          │
                    retry / timeout
                          │
                    circuit breaker
                          │
                    ┌─────▼─────┐
                    │ Provider B │
                    └─────┬─────┘
                          │
                    retry / timeout
                          │
                    ┌─────▼─────┐
                    │   Cache    │
                    │  < 5 min   │
                    └─────┬─────┘
                          │
                          ▼
                       réponse
```

Cela force notamment à réfléchir à **l'ordre dans lequel les patterns sont composés**.

Par exemple :

```text
Rate limiter
     ↓
Bulkhead
     ↓
Circuit breaker
     ↓
Timeout
     ↓
Retry
     ↓
Provider
```

Mais tu ne dois **pas prendre cet ordre comme une solution imposée** : une partie intéressante de l'exercice consiste justement à déterminer où placer chaque mécanisme et pourquoi.

---

# Partie "design"

Avant d'écrire le code, demande-toi de produire un petit dossier de conception.

### 1. Architecture

Définir les composants :

```text
HTTP Controller
      │
      ▼
GetExchangeRate
      │
      ▼
RateProvider
      │
      ├── ResilientProviderA
      │
      └── ResilientProviderB
```

Avec les responsabilités de chaque composant.

### 2. Architecture des dépendances

Par exemple :

```text
domain/
application/
infrastructure/
interfaces/
```

ou une architecture hexagonale.

L'objectif est que le domaine/application **ne connaisse pas Axios, fetch, Express, etc.**

### 3. Composition des patterns

Documenter quelque chose comme :

```text
HTTP request
   │
   ▼
Rate Limiter
   │
   ▼
Bulkhead
   │
   ▼
Circuit Breaker
   │
   ▼
Timeout
   │
   ▼
Retry
   │
   ▼
HTTP Provider
```

et justifier chaque choix.

### 4. Modèle d'erreurs

En TypeScript, définir explicitement les erreurs intéressantes :

```ts
ProviderTimeout
ProviderUnavailable
ProviderRateLimited
ProviderInvalidResponse
CircuitOpen
BulkheadFull
```

Tu peux ainsi travailler sur la distinction entre erreurs récupérables et défauts techniques, sujet également abordé plus récemment par Antoine Coulon. ([Antoine Coulon][3])

---

# Partie "développement"

Le projet pourrait être structuré ainsi :

```text
src/
├── domain/
│   └── exchange-rate.ts
│
├── application/
│   └── get-exchange-rate.ts
│
├── infrastructure/
│   ├── providers/
│   │   ├── provider-a.ts
│   │   └── provider-b.ts
│   │
│   ├── resilience/
│   │   ├── retry.ts
│   │   ├── timeout.ts
│   │   ├── circuit-breaker.ts
│   │   ├── rate-limiter.ts
│   │   └── bulkhead.ts
│   │
│   └── cache/
│       └── exchange-rate-cache.ts
│
└── interfaces/
    └── http/
        └── routes.ts
```

Et surtout : **ne pas utiliser directement une librairie qui implémente tous les patterns**.

Le but pédagogique est de comprendre et coder les mécanismes toi-même.

Tu peux en revanche utiliser :

* Node.js ;
* TypeScript ;
* un framework HTTP minimal ;
* `fetch` ;
* un framework de test ;
* éventuellement une librairie de métriques.

---

# Partie "Chaos Engineering"

Une fois le système fonctionnel, c'est là que l'exercice devient vraiment intéressant.

Tu ajoutes des scénarios de panne :

| Scénario                      | Comportement attendu                     |
| ----------------------------- | ---------------------------------------- |
| Provider A répond normalement | A est utilisé                            |
| A renvoie 500 une fois        | Retry                                    |
| A renvoie 500 plusieurs fois  | Circuit finit par s'ouvrir               |
| A met 10 s à répondre         | Timeout                                  |
| A est lent sous forte charge  | Bulkhead protège l'application           |
| A est indisponible            | B prend le relais                        |
| A + B indisponibles           | Cache utilisé                            |
| Cache expiré                  | Erreur retournée                         |
| Trop de requêtes              | `429`                                    |
| A revient après une panne     | Circuit passe par `HALF-OPEN`            |
| Réponse A invalide            | Pas de retry aveugle, selon ta politique |

Cela te permet de faire une véritable petite expérience de **Chaos Engineering**, plutôt que de simplement tester des fonctions isolées. L'article de la série présente justement le Chaos Engineering comme une manière d'injecter volontairement des défaillances pour découvrir les faiblesses du système. ([Antoine Coulon][2])

---

## Le livrable que je te conseillerais

Pour en faire un **vrai exercice de conception + développement**, je formulerais la mission ainsi :

> **Concevoir et développer un service Node.js/TypeScript de récupération de taux de change capable de continuer à fournir un service dégradé malgré l'indisponibilité, la lenteur ou la surcharge de ses dépendances externes.**
>
> Le système devra intégrer les patterns **Retry, Timeout, Circuit Breaker, Rate Limiting et Bulkhead**, ainsi qu'un mécanisme de fallback entre plusieurs fournisseurs et un cache.
>
> Avant l'implémentation, produire une proposition d'architecture décrivant les composants, leurs responsabilités, les contrats entre composants et la manière dont les différents patterns sont composés.
>
> Implémenter ensuite le système et démontrer, par des tests automatisés et des scénarios de chaos, que chaque mécanisme produit effectivement le comportement attendu.
>
> **Aucune bibliothèque ne doit implémenter directement les patterns de résilience étudiés.** Les mécanismes doivent être implémentés dans le projet afin de permettre d'en comprendre le fonctionnement et les interactions.

À mon avis, c'est un **très bon sujet d'exercice** parce qu'il ne réduit pas la résilience à « implémenter cinq classes ». Le vrai problème devient : **où placer les protections, dans quel ordre les composer, quelles erreurs laisser remonter, et comment le système se comporte quand plusieurs pannes surviennent simultanément**. C'est là que le travail de design devient intéressant.

[1]: https://antoinecoulon.com/blog/category/resilience/ "Resilience - Blog - Antoine Coulon"
[2]: https://antoinecoulon.com/blog/?utm_source=chatgpt.com "Blog - Antoine Coulon"
[3]: https://www.antoinecoulon.com/blog/errors-as-values/?utm_source=chatgpt.com "Errors as values: typed errors vs defects - Antoine Coulon"
