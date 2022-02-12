import zhCNResources from './../i18n/zh-CN.json';
import zhHKResources from './../i18n/zh-HK.json';
import enUSResources from './../i18n/en-US.json';

// Culture interface
export interface ICulture {
    id: string;
    labels: Record<string, string>;
}

/**
 * Supported cultures
 */
export const cultures: ICulture[] = [
    {
        id: 'en-US',
        labels: enUSResources
    },
    {
        id: 'zh-CN',
        labels: zhCNResources
    },
    {
        id: 'zh-HK',
        labels: zhHKResources
    }
];

/**
 * Get culture
 * @param locale Locale
 * @returns Culture
 */
export function getCulture(locale: string) {
    return cultures.find((c) => c.id === locale) ?? cultures[0];
}
