// Imported first by tests: isolate the file store in a temp dir and force the offline AI path.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
process.env.PEAKSHIFT_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "peakshift-test-"));
delete process.env.ANTHROPIC_API_KEY;
