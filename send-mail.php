<?php
header('Content-Type: application/json; charset=utf-8');

$to   = 'shinemedpharmaceuticals@gmail.com';
$from = 'info@shinemedpharmaceuticals.com'; // existing mailbox on this Plesk account

function fail($code, $msg) {
    http_response_code($code);
    echo json_encode(['ok' => false, 'error' => $msg]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail(405, 'Method not allowed.');

// Honeypot: bots fill this hidden field
if (!empty($_POST['website'])) {
    echo json_encode(['ok' => true]);
    exit;
}

function clean($v) {
    return trim(str_replace(["\r", "\n"], ' ', strip_tags((string) $v)));
}

$first   = clean($_POST['firstName'] ?? '');
$last    = clean($_POST['lastName'] ?? '');
$email   = clean($_POST['email'] ?? '');
$phone   = clean($_POST['phone'] ?? '');
$message = trim(strip_tags((string) ($_POST['message'] ?? '')));

if ($first === '' || $message === '') fail(422, 'Please enter your name and message.');
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) fail(422, 'Please enter a valid email address.');
if (strlen($message) > 5000) fail(422, 'Message is too long.');

$subject = 'Website enquiry from ' . trim("$first $last");
$body = "Name: $first $last\nEmail: $email\nPhone: $phone\n\nMessage:\n$message\n";

$headers = [
    'From: Shinemed Website <' . $from . '>',
    'Reply-To: ' . $email,
    'Content-Type: text/plain; charset=utf-8',
    'X-Mailer: PHP/' . phpversion(),
];

if (!mail($to, '=?UTF-8?B?' . base64_encode($subject) . '?=', $body, implode("\r\n", $headers), '-f' . $from)) {
    fail(500, 'Could not send your message. Please email us directly.');
}

echo json_encode(['ok' => true]);
