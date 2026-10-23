import zhCN from './catalogs/zh-cn.json';
import es from './catalogs/es.json';
import ptBR from './catalogs/pt-br.json';
import de from './catalogs/de.json';
import fr from './catalogs/fr.json';
import tr from './catalogs/tr.json';
import pl from './catalogs/pl.json';
import ja from './catalogs/ja.json';
import ko from './catalogs/ko.json';
import zhTW from './catalogs/zh-tw.json';
import ru from './catalogs/ru-supplement.json';
import type {LocalePack} from './registry';

// Ready-to-use declarative drafts. No translation engine or network is used at runtime.
export const standardPacks:readonly LocalePack[]=[zhCN,es,ptBR,de,fr,tr,pl,ja,ko,zhTW,ru] as LocalePack[];
