<?php
// wfile() must still write when flock/LOCK_EX is refused (network filesystems). A stream wrapper without stream_lock
// makes flock() and file_put_contents(LOCK_EX) fail, like a filesystem that cannot lock.
$src = file_get_contents(__DIR__ . '/../web/net/signal.php');
preg_match('/function wfile\(.*?\n}\n/s', $src, $m) or die("FAIL no wfile\n"); eval($m[0]);
class NoLock { static $d = []; public $context; private $p, $pos = 0;
  function stream_open($path, $mode) { $this->p = $path; if (!isset(self::$d[$path])) self::$d[$path] = ''; if ($mode[0] === 'a') $this->pos = strlen(self::$d[$path]); return true; }
  function stream_write($x) { self::$d[$this->p] = substr(self::$d[$this->p], 0, $this->pos) . $x; $this->pos += strlen($x); return strlen($x); }
  function stream_truncate($n) { self::$d[$this->p] = substr(self::$d[$this->p], 0, $n); return true; }
  function stream_flush() { return true; } function stream_close() {} function stream_eof() { return true; } function stream_read($n) { return ''; }
  function stream_stat() { return []; } function url_stat($p, $f) { return isset(self::$d[$p]) ? ['size' => strlen(self::$d[$p])] : false; } }
stream_wrapper_register('nolock', 'NoLock');
$ok = true; $c = function ($n, $v) use (&$ok) { $ok &= $v; echo ($v ? 'ok   ' : 'FAIL ') . "$n\n"; };
$c('file_put_contents LOCK_EX fails on this wrapper (precondition)', @file_put_contents('nolock://x', 'a', LOCK_EX) === false);
$c('flock fails on this wrapper (precondition)', !@flock(fopen('nolock://y', 'c'), LOCK_EX));
$c('append without lock', wfile('nolock://log', "l1\n", true) && wfile('nolock://log', "l2\n", true) && NoLock::$d['nolock://log'] === "l1\nl2\n");
$c('overwrite without lock', wfile('nolock://stat', 'longer-old') && wfile('nolock://stat', 'new') && NoLock::$d['nolock://stat'] === 'new');
$c('no LOCK_EX passed to file_put_contents in signal.php', !preg_match('/file_put_contents\([^;]*LOCK_EX/', $src));
exit($ok ? 0 : 1);
