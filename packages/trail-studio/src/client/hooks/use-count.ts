import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

// só ativa quando pausado: contagem em background pra mostrar badge "N new ↑"
export function useCount(search: URLSearchParams, latestCursor: string | null, paused: boolean) {
	const params = new URLSearchParams(search);
	params.delete("before");
	params.delete("after");

	if (latestCursor !== null) params.set("after", latestCursor);

	return useQuery({
		queryKey: ["count", params.toString(), latestCursor],
		queryFn: () => api.count(params),
		refetchInterval: paused ? 3000 : false,
		enabled: paused && latestCursor !== null,
	});
}
