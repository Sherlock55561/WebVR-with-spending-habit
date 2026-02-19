const assert = require("assert");
const common = require("./common");

function withMockDocument(mockDocument, fn) {
  const prev = global.document;
  global.document = mockDocument;
  try {
    fn();
  } finally {
    if (typeof prev === "undefined") {
      delete global.document;
    } else {
      global.document = prev;
    }
  }
}

function testUpdateFunctionDoesNotCrashWhenProducerMissing() {
  const self = {
    data: { from: "allData", data: "" },
    el: { components: {} },
    processData: function () {},
    newData: null
  };
  const oldData = { from: "" };

  const mockDocument = {
    getElementById: function () {
      return { components: {} };
    },
    querySelectorAll: function () {
      return [];
    }
  };

  assert.doesNotThrow(function () {
    withMockDocument(mockDocument, function () {
      common.updateFunction(self, oldData);
    });
  });
  assert.strictEqual(self.prodComponent, undefined);
}

function testUpdateFunctionRegistersWhenProducerExists() {
  let registerCalled = false;
  const producer = {
    notiBuffer: {
      register: function () {
        registerCalled = true;
        return "sub-1";
      }
    }
  };
  const self = {
    data: { from: "allData", data: "" },
    el: { components: {} },
    processData: function () {},
    newData: null
  };
  const oldData = { from: "" };

  const mockDocument = {
    getElementById: function () {
      return { components: { "babia-querycsv": producer } };
    },
    querySelectorAll: function () {
      return [];
    }
  };

  withMockDocument(mockDocument, function () {
    common.updateFunction(self, oldData);
  });
  assert.strictEqual(registerCalled, true);
  assert.strictEqual(self.notiBufferId, "sub-1");
}

function main() {
  testUpdateFunctionDoesNotCrashWhenProducerMissing();
  testUpdateFunctionRegistersWhenProducerExists();
  console.log("common tests passed");
}

main();
