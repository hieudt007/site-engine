import { FastifyInstance } from "fastify";
import { z } from "zod";
import { CacheService } from "../../services/CacheService.js";

const autocompleteSchema = z.object({
  input: z.string().min(1),
});

export async function registerAddressAutocompleteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/address-autocomplete", async (request, reply) => {
    const parsed = autocompleteSchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ predictions: [] });
    }

    const siteConfig = await CacheService.getSiteConfig();
    const apiKey = (siteConfig as any)?.goongApiKey;

    if (!apiKey) {
      return { predictions: [] };
    }

    try {
      const goongUrl = `https://rsapi.goong.io/v2/place/autocomplete?api_key=${apiKey}&input=${encodeURIComponent(parsed.data.input)}`;
      const response = await fetch(goongUrl, { signal: AbortSignal.timeout(8000) });
      
      if (!response.ok) {
        return { predictions: [] };
      }

      const data = await response.json() as any;
      const predictions = Array.isArray(data.predictions) ? data.predictions : [];
      
      return {
        predictions: predictions.map((p: any) => ({
          description: p.description || "",
          place_id: p.place_id || "",
        }))
      };
    } catch (error) {
      request.log.error(error, "Goong API autocomplete failed");
      return { predictions: [] };
    }
  });
}
