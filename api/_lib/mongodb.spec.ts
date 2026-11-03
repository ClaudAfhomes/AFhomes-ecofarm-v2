import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn(), command: vi.fn(), close: vi.fn() }));
vi.mock('mongodb', () => ({
  MongoClient: class {
    connect = mocks.connect;
    close = mocks.close;
    db(name: string) {
      expect(name).toBe('afhomes_dev');
      return { command: mocks.command };
    }
  },
}));
import { createMongoClient, pingMongoDB } from './mongodb.js';

const env = { MONGODB_URI: 'mongodb://localhost:27017', MONGODB_DB: 'afhomes_dev' };
describe('MongoDB connection foundation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.command.mockResolvedValue({ ok: 1 });
  });
  it('rejects missing credentials and every other database before connecting', () => {
    expect(() => createMongoClient({})).toThrow('MONGODB_URI');
    expect(() => createMongoClient({ ...env, MONGODB_DB: 'other' })).toThrow('afhomes_dev');
    expect(mocks.connect).not.toHaveBeenCalled();
  });
  it('executes only ping and always closes', async () => {
    await pingMongoDB(env);
    expect(mocks.command).toHaveBeenCalledExactlyOnceWith({ ping: 1 });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('closes after a connection failure', async () => {
    mocks.connect.mockRejectedValue(new Error('unavailable'));
    await expect(pingMongoDB(env)).rejects.toThrow('unavailable');
    expect(mocks.command).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });
  it('rejects failed ping and closes', async () => {
    mocks.command.mockResolvedValue({ ok: 0 });
    await expect(pingMongoDB(env)).rejects.toThrow('did not succeed');
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
