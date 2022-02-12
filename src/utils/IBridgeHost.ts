/**
 * Bridge host
 */
export interface IBridgeHost {
    /**
     * Change culture
     * @param locale Locale
     */
    changeCulture(locale: string): void;

    /**
     * Exit the application
     */
    exit(): void;

    /**
     * Get app start Url / router Url
     */
    getStartUrl(): string | undefined | null;

    /**
     * Load application
     * @param name App name
     * @param startUrl Start Url / router Url
     */
    loadApp(name: string, startUrl?: string): void;
}
