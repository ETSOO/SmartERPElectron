import zhHansResources from './../i18n/zh-Hans.json';
import zhHantResources from './../i18n/zh-Hant.json';
import enResources from './../i18n/en.json';

// Culture interface
export interface ICulture {
    id: string;
    labels: Record<string, string>;
    compatibleNames: string[];
}

/**
 * Supported cultures
 */
export const cultures: ICulture[] = [
    {
        id: 'en',
        labels: enResources,
        compatibleNames: []
    },
    {
        id: 'zh-Hans',
        labels: zhHansResources,
        compatibleNames: ['zh-CN', 'zh-SG']
    },
    {
        id: 'zh-Hant',
        labels: zhHantResources,
        compatibleNames: ['zh-HK', 'zh-TW', 'zh-MO']
    }
];

/**
 * Get culture
 * @param locale Locale
 * @returns Culture
 */
export function getCulture(locale: string) {
    // Exact mach
    let culture = cultures.find((c) => c.id === locale);
    if (culture == null) {
        culture = cultures.find(
            (c) =>
                locale.startsWith(c.id + '-') ||
                c.compatibleNames.includes(locale)
        );
    }
    if (culture == null) culture = cultures[0];
    return culture;
}
