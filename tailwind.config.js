/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors:{
        bg:"#0b1222", elev:"#0f1a33", primary:"#2e59c6", primary2:"#7ecdf2", text:"#e8f0ff", muted:"#9fb2d9"
      },
      boxShadow:{ glass:"0 10px 30px rgba(0,0,0,.35)" },
      borderRadius:{ xl2:"1rem", "2xl":"1.25rem" }
    }
  },
  plugins: []
}
