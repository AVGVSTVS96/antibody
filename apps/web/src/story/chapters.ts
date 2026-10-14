import type { ComponentType } from "react";
import type { BillModel } from "../lib/model.ts";
import C1 from "./C1.tsx";
import C2 from "./C2.tsx";
import C3 from "./C3.tsx";
import C4 from "./C4.tsx";
import C5 from "./C5.tsx";
import C6 from "./C6.tsx";

export const CHAPTERS: ComponentType<{ m: BillModel }>[] = [C1, C2, C3, C4, C5, C6];
