import type { MigrationEntry } from '../../migrate.js';

/**
 * Stores the Mini App permissions a person turned off.
 *
 * A missing row is the enabled state: a newly installed package, a package that gained a declared
 * item in an update, and an item nobody has touched all read as on. Only a decision to deny is
 * durable, so no install path has to seed this table.
 */
export const migration: MigrationEntry = {
  version: 55,
  name: 'create_plugin_miniapp_permission',
  up: `
    CREATE TABLE IF NOT EXISTS local_runtime_plugin_miniapp_permission (
      plugin_id TEXT NOT NULL,
      plugin_source TEXT NOT NULL,
      permission TEXT NOT NULL,
      enabled INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      PRIMARY KEY (plugin_id, plugin_source, permission),
      CONSTRAINT local_runtime_plugin_miniapp_permission_source
        CHECK (plugin_source IN ('local', 'official')),
      CONSTRAINT local_runtime_plugin_miniapp_permission_enabled CHECK (enabled IN (0, 1))
    );
  `,
};
