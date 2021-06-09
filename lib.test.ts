const { describe, it } = intern.getPlugin('interface.bdd');
const { destinations, parseJSON } = require('./lib')
const { assert } = intern.getPlugin('chai');

describe('destinations are parsed', async () => {
  const out = await destinations()
  assert.isString(out.tvOS)
  assert.isString(out.iOS)
  assert.isString(out.watchOS)
});

const json =`
{
  "project" : {
    "configurations" : [
      "Debug",
      "Release"
    ],
    "name" : "CombineCloudKit",
    "schemes" : [
      "CombineCloudKit-Package"
    ],
    "targets" : [
      "CombineCloudKit",
      "CombineCloudKitPackageDescription",
      "CombineCloudKitPackageTests",
      "CombineCloudKitTests",
      "CombineExpectations",
      "CombineExpectationsPackageDescription"
    ]
  }
}
build session not created after 15 seconds - still waiting
`

describe('Bad xcodebuild output JSON is parsed', () => {
  parseJSON(json)
})
