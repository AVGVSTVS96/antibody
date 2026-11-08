import { join } from "node:path";
import { billRef, billstatusUrl } from "@antibody/core";
import type { BillId } from "@antibody/core";
import { paths } from "@antibody/core/node";
import { cached, FetchError } from "./fetch.ts";
import { all, element, isElement, parseXml, text } from "./xml.ts";
import type { Xml, XmlElement } from "./xml.ts";

export async function billstatus(bill: BillId, refresh = false): Promise<XmlElement | null> {
  const { congress, type, number } = billRef(bill);
  const file = join(paths.raw("bills"), "billstatus", `BILLSTATUS-${congress}${type}${number}.xml`);

  try {
    const body = await cached(billstatusUrl(bill), file, refresh);

    return element(element(parseXml(body), "billStatus"), "bill");
  } catch (error) {
    if (error instanceof FetchError && error.status === 404) {
      return null;
    }

    throw error;
  }
}

export interface RecordedVote {
  rollNumber: string;
  url: string;
  chamber: "House" | "Senate";
  congress: string;
  sessionNumber: string;
  date: string;
}

function recordedVote(node: XmlElement): RecordedVote {
  const chamber = text(node, "chamber");

  if (chamber !== "House" && chamber !== "Senate") {
    throw new Error(`recordedVote chamber is neither House nor Senate: ${chamber}`);
  }

  return {
    rollNumber: text(node, "rollNumber"),
    url: text(node, "url"),
    chamber,
    congress: text(node, "congress"),
    sessionNumber: text(node, "sessionNumber"),
    date: text(node, "date"),
  };
}

export function recordedVotes(bill: XmlElement): RecordedVote[] {
  const found = new Map<string, RecordedVote>();

  const walk = (node: Xml | undefined): void => {
    if (Array.isArray(node)) {
      node.forEach(walk);

      return;
    }

    if (!isElement(node)) {
      return;
    }

    for (const [tag, child] of Object.entries(node)) {
      if (tag === "recordedVote") {
        for (const rv of all(node, tag).map(recordedVote)) {
          found.set(rv.url, rv);
        }
      } else {
        walk(child);
      }
    }
  };

  walk(bill);

  return [...found.values()];
}
