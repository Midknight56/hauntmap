import { cleanup, screen, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { chooseFiles, folderInput, installDirectoryInput, makeHarness, removeDirectoryInput, sizedFile } from "./dialogHarness";

// 1.6, the rendering case (the source scan is in no-html-injection.test.ts): a chosen folder named
// `a&b<img src=x onerror=alert(1)>` appears verbatim in the review, and no `img` element is made from it.

beforeAll(installDirectoryInput);
afterAll(removeDirectoryInput);
afterEach(cleanup);

const HOSTILE = "a&b<img src=x onerror=alert(1)>";

describe("a hostile folder name is text (1.6)", () => {
  it("appears verbatim in the review and makes no element", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), [
      sizedFile(HOSTILE, "src/a.ts", 10),
      sizedFile(HOSTILE, 'src/<b onmouseover="alert(1)">.ts', 10),
      sizedFile(HOSTILE, "README&amp;.md", 5),
    ]);
    const box = screen.getByRole("dialog");
    expect(within(box).getByText(`Folder: ${HOSTILE}`)).toBeTruthy();
    expect(box.textContent).toContain(HOSTILE);
    expect(within(box).getByText('src/<b onmouseover="alert(1)">.ts')).toBeTruthy();
    expect(within(box).getByText("README&amp;.md \u00b7 other file type")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
    expect(document.querySelector("[onerror], [onmouseover]")).toBeNull();
  });

  it("appears verbatim in the no files sentence", () => {
    const h = makeHarness();
    void h.open();
    chooseFiles(folderInput(), [sizedFile(HOSTILE, "README.md", 5)]);
    expect(screen.getByText(`No JavaScript or TypeScript files were found in ${HOSTILE} (1 files skipped).`)).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });
});
