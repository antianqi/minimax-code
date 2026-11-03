import { describe, expect, it } from 'vitest';

import {
  parseListeningSocketInodes,
  parseLsofPids,
  parseProcessBySocketInode,
  readPortOwnerPid,
} from '../../../src/service/miniapp/process/node-runtime/port-owner-pid.js';

const PROC_TABLE = [
  '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
  '   0: 0100007F:9286 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 159874 1 0000000000000000 100 0 0 10 0',
  '   1: 0100007F:9092 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 159876 1 0000000000000000 100 0 0 10 0',
  '   2: 0100007F:1F90 0100007F:9092 01 00000000:00000000 00:00000000 00000000  1000        0 159878 1 0000000000000000 100 0 0 10 0',
].join('\n');

describe('the process that holds a port', () => {
  it('names the socket listening on the port, and nothing else', () => {
    expect(parseListeningSocketInodes(PROC_TABLE, 37_510)).toEqual([159_874]);
    expect(parseListeningSocketInodes(PROC_TABLE, 37_010)).toEqual([159_876]);
    // A connected socket is not a listener, and a socket on another port says
    // nothing about this one.
    expect(parseListeningSocketInodes(PROC_TABLE, 8_080)).toEqual([]);
    expect(parseListeningSocketInodes(PROC_TABLE, 50_123)).toEqual([]);
  });

  it('says nothing about a table it cannot read', () => {
    expect(parseListeningSocketInodes('', 37_510)).toEqual([]);
    expect(parseListeningSocketInodes('not a table', 37_510)).toEqual([]);
  });

  it('finds the process that holds the socket', () => {
    const entries = [
      { pid: 41, links: ['/dev/null', 'socket:[159876]'] },
      { pid: 77, links: ['socket:[159874]', 'socket:[159878]'] },
    ];
    expect(parseProcessBySocketInode(entries, 159_874)).toBe(77);
    expect(parseProcessBySocketInode(entries, 159_878)).toBe(77);
    expect(parseProcessBySocketInode(entries, 1_234_567)).toBeUndefined();
  });

  it('reads the pids a listing tool named', () => {
    expect(parseLsofPids('4242\n4243\n')).toEqual([4242, 4243]);
    expect(parseLsofPids('')).toEqual([]);
    expect(parseLsofPids('not a pid\n')).toEqual([]);
  });

  it('asks the platform for the process that holds the port', async () => {
    const asked: number[] = [];
    const pid = await readPortOwnerPid({
      port: 50_123,
      platform: 'linux',
      readPortOwnerPid: async (port) => {
        asked.push(port);
        return 4242;
      },
    });
    expect(pid).toBe(4242);
    expect(asked).toEqual([50_123]);
  });

  it('has no answer on a platform that cannot name its processes', async () => {
    expect(await readPortOwnerPid({ port: 50_123, platform: 'aix' })).toBeUndefined();
  });
});
