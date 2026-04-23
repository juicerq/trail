import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useSchema() {
	return useQuery({
		queryKey: ["schema"],
		queryFn: api.schema,
		staleTime: Infinity,
	});
}
