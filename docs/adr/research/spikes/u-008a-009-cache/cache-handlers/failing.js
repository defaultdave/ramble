// Remote handler whose every call throws: models Vercel's runtime cache being unreachable.
const boom = (m) => { throw new Error('simulated remote cache outage: ' + m); };
module.exports = {
  async get() { boom('get'); },
  async set() { boom('set'); },
  async refreshTags() {},
  async getExpiration() { return 0; },
  async updateTags() { boom('updateTags'); },
};
