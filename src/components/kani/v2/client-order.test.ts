import { describe, expect, it } from "vitest";
import { sortClients } from "./client-order";

const clients = [
  { name: "Zoe", created_at: "2026-03-01T12:00:00Z", lastVisit: "2026-10-20" },
  { name: "Álvaro", created_at: "2026-10-01T12:00:00Z", lastVisit: "2026-10-01" },
  { name: "Martín", created_at: "2026-06-01T12:00:00Z", lastVisit: "2026-10-21" },
];

describe("client presentation order", () => {
  it("uses creation date independently of visit history", () => {
    expect(sortClients(clients, "newest").map((c) => c.name)).toEqual(["Álvaro", "Martín", "Zoe"]);
    expect(sortClients(clients, "oldest").map((c) => c.name)).toEqual(["Zoe", "Martín", "Álvaro"]);
  });
  it("uses Spanish alphabetical order in both directions", () => {
    expect(sortClients(clients, "name-asc").map((c) => c.name)).toEqual([
      "Álvaro",
      "Martín",
      "Zoe",
    ]);
    expect(sortClients(clients, "name-desc").map((c) => c.name)).toEqual([
      "Zoe",
      "Martín",
      "Álvaro",
    ]);
  });
  it("does not mutate shared state and retains equal-date order", () => {
    const before = [...clients];
    sortClients(clients, "newest");
    expect(clients).toEqual(before);
    expect(
      sortClients([clients[0], { ...clients[1], created_at: clients[0].created_at }], "oldest")[0],
    ).toBe(clients[0]);
  });
});
