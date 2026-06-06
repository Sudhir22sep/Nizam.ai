FROM node:22-alpine

WORKDIR /usr/src/app

COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .
RUN npm run build

EXPOSE 4200

CMD ["npm", "run", "serve:ssr:Nizam"]
