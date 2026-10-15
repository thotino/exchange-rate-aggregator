export interface BaseConnectorInterface {
    connect: () => Promise<void>;
    close: () => Promise<void>;
}
