import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import { functions } from "../../../inngest/functions";

// Inngest's HTTP endpoint. inngest-cli dev (in dev) or Inngest cloud (in prod) polls this
// to discover registered functions and deliver events.
export const { GET, POST, PUT } = serve({ client: inngest, functions });
