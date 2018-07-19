# My-Wallet

Source code for [blockchain.info](https://blockchain.info/). Please [contact support](http://blockchain.zendesk.com/) if you experience any issues as a user.

## Setup

Make sure you have [Node.js](http://nodejs.org/) installed.

Install dependencies:
```sh
npm install -g grunt-cli
npm install
```

Create a file called `.env` in the root of the project. Put the following in it:

```
ROOT_URL=https://blockchain.info/
```

## Build

Grunt watches and compiles the Javascript. Keep it running:
```sh
grunt
```

## Run

Run local http server:
```sh
npm start
```

Visit [local.blockchain.com:8080](http://local.blockchain.com:8080/).  Do not use `localhost:8080`. You will need to modify your "hosts" file (`/etc/hosts` on OSX and most UNIX systems) because this is no longer registered at the DNS level for application security reasons. Add this line to `/etc/hosts`:

    127.0.0.1   local.blockchain.com

## Contributing

Consider contributing to the [new and improved wallet](https://github.com/blockchain/My-Wallet-V3-Frontend)

## Usage

You can open any wallet, but you can't create one (yet).

## Security

Security issues can be reported to us in the following venues:

 * Email: security@blockchain.info
 * Bug Bounty: https://www.crowdcurity.com/blockchain-info
