import { describe, expect, it } from "vitest"

import {
  buildAccountGroups,
  firstCodeRecord,
  maskPhoneNumber,
  orderKey,
  statusCountsFromOrders,
} from "./dashboard"
import type { KitesimMessage, KitesimOrder } from "@/types"

const orders: KitesimOrder[] = [
  {
    id: 101,
    accountId: "acct_primary",
    accountLabel: "主号码",
    messageHandle: "signed-primary",
    phoneNumber: "+15550000001",
    orderStatus: 2,
    statusLabel: "使用中",
  },
  {
    id: 202,
    accountId: "acct_secondary",
    accountLabel: "备用号码",
    messageHandle: "signed-secondary",
    phoneNumber: "+447400123831",
    orderStatus: 1,
    statusLabel: "激活中",
  },
]

describe("dashboard domain helpers", () => {
  it("builds a stable account-scoped order key", () => {
    expect(orderKey(orders[0])).toBe("acct_primary:101")
  })

  it("masks international phone numbers while preserving recognition", () => {
    expect(maskPhoneNumber("+15550000001")).toBe("+1 555 ••• •001")
    expect(maskPhoneNumber("+447400123831")).toBe("+44 7400 ••• •831")
  })

  it("groups orders by account without losing account labels", () => {
    expect(buildAccountGroups(orders)).toEqual([
      {
        accountId: "acct_primary",
        accountLabel: "主号码",
        orders: [orders[0]],
      },
      {
        accountId: "acct_secondary",
        accountLabel: "备用号码",
        orders: [orders[1]],
      },
    ])
  })

  it("finds the first message carrying a verification code", () => {
    const input: KitesimMessage[] = [
      { id: 1, sender: "Service", content: "No code", code: [] },
      { id: 2, sender: "Google", content: "Code", code: ["438921"] },
    ]
    expect(firstCodeRecord(input)).toEqual({ code: "438921", message: input[1] })
  })

  it("counts only statuses present in the current order set", () => {
    expect(statusCountsFromOrders(orders)).toEqual({ 1: 1, 2: 1, all: 2 })
  })
})
