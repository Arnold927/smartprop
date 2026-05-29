import { useMutation } from "@tanstack/react-query";
import axios from "axios";

export function useLogin() {
  return useMutation({
    mutationFn: async ({ username, password }: { username: string; password: string }) => {
      const response = await axios.post("http://localhost:8000/api/token/", {
        username,
        password,
      });
      // Save tokens
      localStorage.setItem("access_token", response.data.access);
      localStorage.setItem("refresh_token", response.data.refresh);
      return response.data;
    },
  });
}
