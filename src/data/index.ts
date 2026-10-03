import { config } from '../lib/env';
import type { DataSource } from './source';
import { DemoSource } from './demo/DemoSource';
import { HttpSource } from './http/HttpSource';

let instance: DataSource | undefined;

/** The single place that decides where data comes from. */
export function getDataSource(): DataSource {
  if (instance) return instance;
  instance =
    config.dataSource === 'api'
      ? new HttpSource({ baseUrl: config.apiUrl, liveUrl: config.liveUrl, pollMs: config.livePollMs })
      : new DemoSource(config.archiveStart);
  return instance;
}

export type { DataSource } from './source';
export * from './types';
