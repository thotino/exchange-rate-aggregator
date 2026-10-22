import { Currencies } from "../../interfaces/types";
function normalizeCurrencyCode(value: Currencies) {
    if (!/^[A-Za-z]{3}$/.test(value)) {
        return null;
    }

    return value.toUpperCase();
}
export class ExchangeRate {
    static generateExchangeRate(source: Currencies, destination: Currencies) {
        const normalizedSource = normalizeCurrencyCode(source);
        const normalizedDestination = normalizeCurrencyCode(destination);

        if (normalizedSource == null || normalizedDestination == null) {
            return null;
        }

        if (normalizedSource === normalizedDestination) {
            return 1;
        }

        const pair = `${normalizedSource}:${normalizedDestination}`;
        let hash = 2166136261;

        for (const character of pair) {
            hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
        }

        return {
            rate:
                Math.round(
                    (0.5 + Math.random() + (hash % 200001) / 100000) * 100000,
                ) / 100000,
            asOf: Date.now(),
            pair,
        };
    }
}
