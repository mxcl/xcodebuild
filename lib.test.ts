const { describe, it } = intern.getPlugin('interface.bdd');
const { destinations } = require('./lib')
const { assert } = intern.getPlugin('chai');

describe('destinations are parsed', async () => {
  const out = await destinations()
  assert.isString(out.tvOS)
  assert.isString(out.iOS)
  assert.isString(out.watchOS)
});
